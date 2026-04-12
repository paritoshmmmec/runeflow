import { SkillSyntaxError } from "./errors.js";
import { getByPath, shellEscape } from "./utils.js";

export const STEP_STATE_FIELDS = new Set([
  "status",
  "error",
  "attempts",
  "artifact_path",
  "result_path",
  "inputs",
  "outputs",
  "started_at",
  "finished_at",
]);

function tokenize(expression) {
  const tokens = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ type: char, value: char });
      index += 1;
      continue;
    }

    if (expression.startsWith("==", index) || expression.startsWith("!=", index)) {
      const operator = expression.slice(index, index + 2);
      tokens.push({ type: "operator", value: operator });
      index += 2;
      continue;
    }

    if (char === "?" || char === ":") {
      tokens.push({ type: char, value: char });
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      const quote = char;
      let value = "";
      index += 1;

      while (index < expression.length) {
        const current = expression[index];

        if (current === "\\") {
          value += expression[index + 1] ?? "";
          index += 2;
          continue;
        }

        if (current === quote) {
          index += 1;
          break;
        }

        value += current;
        index += 1;
      }

      tokens.push({ type: "string", value });
      continue;
    }

    if (/[0-9]/.test(char)) {
      const match = expression.slice(index).match(/^[0-9]+(?:\.[0-9]+)?/);
      tokens.push({ type: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }

    const identifier = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_.-]*/);

    if (!identifier) {
      throw new SkillSyntaxError(`Unsupported token in expression: ${expression.slice(index)}`);
    }

    const value = identifier[0];

    if (value === "and" || value === "or" || value === "not" || value === "matches") {
      tokens.push({ type: "keyword", value });
    } else if (value === "true" || value === "false") {
      tokens.push({ type: "boolean", value: value === "true" });
    } else if (value === "null") {
      tokens.push({ type: "null", value: null });
    } else {
      tokens.push({ type: "path", value });
    }

    index += value.length;
  }

  return tokens;
}

function buildParser(tokens) {
  let index = 0;

  function peek() {
    return tokens[index];
  }

  function consume() {
    return tokens[index++];
  }

  function match(type, value) {
    const token = peek();
    if (!token) {
      return false;
    }

    if (token.type !== type) {
      return false;
    }

    if (value !== undefined && token.value !== value) {
      return false;
    }

    index += 1;
    return token;
  }

  function parsePrimary() {
    const token = peek();

    if (!token) {
      throw new SkillSyntaxError("Unexpected end of expression.");
    }

    if (match("(")) {
      const expression = parseOr();
      if (!match(")")) {
        throw new SkillSyntaxError("Expected closing ')'.");
      }
      return expression;
    }

    if (token.type === "string" || token.type === "number" || token.type === "boolean" || token.type === "null") {
      consume();
      return { type: "literal", value: token.value };
    }

    if (token.type === "path") {
      consume();
      return { type: "path", value: token.value };
    }

    throw new SkillSyntaxError(`Unexpected token '${token.value}' in expression.`);
  }

  function parseUnary() {
    if (match("keyword", "not")) {
      return {
        type: "unary",
        operator: "not",
        value: parseUnary(),
      };
    }

    return parsePrimary();
  }

  function parseEquality() {
    let left = parseUnary();

    while (true) {
      if (match("keyword", "matches")) {
        const pattern = peek();
        if (!pattern || pattern.type !== "string") {
          throw new SkillSyntaxError("'matches' operator requires a string pattern.");
        }
        consume();
        left = {
          type: "binary",
          operator: "matches",
          left,
          right: { type: "literal", value: pattern.value },
        };
        continue;
      }

      const operator = match("operator", "==") || match("operator", "!=");
      if (!operator) {
        return left;
      }

      left = {
        type: "binary",
        operator: operator.value,
        left,
        right: parseUnary(),
      };
    }
  }

  function parseAnd() {
    let left = parseEquality();

    while (match("keyword", "and")) {
      left = {
        type: "binary",
        operator: "and",
        left,
        right: parseEquality(),
      };
    }

    return left;
  }

  function parseOr() {
    let left = parseAnd();

    while (match("keyword", "or")) {
      left = {
        type: "binary",
        operator: "or",
        left,
        right: parseAnd(),
      };
    }

    return left;
  }

  function parseTernary() {
    const condition = parseOr();

    if (!match("?")) {
      return condition;
    }

    const consequent = parseTernary();

    if (!match(":")) {
      throw new SkillSyntaxError("Expected ':' in ternary expression.");
    }

    const alternate = parseTernary();

    return { type: "ternary", condition, consequent, alternate };
  }

  function parseExpressionAst() {
    const ast = parseTernary();
    if (index < tokens.length) {
      throw new SkillSyntaxError(`Unexpected trailing token '${tokens[index].value}'.`);
    }
    return ast;
  }

  return { parseExpressionAst };
}

export function parseExpression(expression) {
  return buildParser(tokenize(expression)).parseExpressionAst();
}

function resolvePath(pathExpression, state) {
  const segments = pathExpression.split(".");

  if (segments[0] === "const") {
    return getByPath(state.consts ?? {}, segments.slice(1));
  }

  if (segments[0] === "inputs") {
    return getByPath(state.inputs, segments.slice(1));
  }

  if (segments[0] === "steps") {
    const [, stepId, ...rest] = segments;
    const stepState = state.stepMap[stepId];

    if (!stepState) {
      return { found: false, value: undefined };
    }

    if (rest.length === 0) {
      return { found: true, value: stepState.outputs };
    }

    if (rest[0] in stepState && STEP_STATE_FIELDS.has(rest[0])) {
      if (rest.length === 1) {
        return { found: true, value: stepState[rest[0]] };
      }

      return getByPath(stepState[rest[0]], rest.slice(1));
    }

    // If the step was skipped (outputs: null), return empty string for any
    // field access so {{ skipped.field }} resolves to "" rather than throwing.
    if (stepState.outputs === null || stepState.outputs === undefined) {
      return { found: true, value: "" };
    }

    return getByPath(stepState.outputs ?? {}, rest);
  }

  return { found: false, value: undefined };
}

function evaluateAst(node, state) {
  if (node.type === "literal") {
    return node.value;
  }

  if (node.type === "path") {
    const resolved = resolvePath(node.value, state);
    if (!resolved.found) {
      throw new SkillSyntaxError(`Unknown reference '${node.value}'.`);
    }
    return resolved.value;
  }

  if (node.type === "unary") {
    return !Boolean(evaluateAst(node.value, state));
  }

  if (node.type === "ternary") {
    return Boolean(evaluateAst(node.condition, state))
      ? evaluateAst(node.consequent, state)
      : evaluateAst(node.alternate, state);
  }

  if (node.type === "binary") {
    const left = evaluateAst(node.left, state);
    const right = evaluateAst(node.right, state);

    switch (node.operator) {
      case "==":
        return left === right;
      case "!=":
        return left !== right;
      case "matches":
        if (typeof left !== "string") return false;
        return new RegExp(right).test(left);
      case "and":
        return Boolean(left) && Boolean(right);
      case "or":
        return Boolean(left) || Boolean(right);
      default:
        throw new SkillSyntaxError(`Unsupported operator '${node.operator}'.`);
    }
  }

  throw new SkillSyntaxError("Unsupported expression node.");
}

export function hasTemplateExpressions(value) {
  return typeof value === "string" && value.includes("{{");
}

function parseTemplateSegments(template) {
  const segments = [];
  let cursor = 0;

  while (cursor < template.length) {
    const openIndex = template.indexOf("{{", cursor);

    if (openIndex === -1) {
      if (cursor < template.length) {
        segments.push({ type: "text", value: template.slice(cursor) });
      }
      break;
    }

    if (openIndex > cursor) {
      segments.push({ type: "text", value: template.slice(cursor, openIndex) });
    }

    const closeIndex = template.indexOf("}}", openIndex + 2);
    if (closeIndex === -1) {
      throw new SkillSyntaxError("Unterminated template expression.");
    }

    const expression = template.slice(openIndex + 2, closeIndex).trim();
    if (!expression) {
      throw new SkillSyntaxError("Template expression cannot be empty.");
    }

    segments.push({ type: "expression", value: expression });
    cursor = closeIndex + 2;
  }

  return segments;
}

export function collectTemplatePaths(template) {
  return parseTemplateSegments(template)
    .filter((segment) => segment.type === "expression")
    .flatMap((segment) => collectExpressionPaths(segment.value));
}

export function resolveTemplate(template, state) {
  const segments = parseTemplateSegments(template);
  const expressionSegments = segments.filter((segment) => segment.type === "expression");

  if (expressionSegments.length === 1 && segments.length === 1) {
    return evaluateExpression(expressionSegments[0].value, state);
  }

  return segments
    .map((segment) => {
      if (segment.type === "text") {
        return segment.value;
      }

      const resolved = evaluateExpression(segment.value, state);
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    })
    .join("");
}

export function resolveShellTemplate(template, state) {
  const segments = parseTemplateSegments(template);
  const expressionSegments = segments.filter((segment) => segment.type === "expression");

  if (expressionSegments.length === 0) {
    return segments.map((segment) => segment.value).join("");
  }

  if (expressionSegments.length === 1 && segments.length === 1) {
    const resolved = evaluateExpression(expressionSegments[0].value, state);
    return shellEscape(resolved);
  }

  return segments
    .map((segment) => {
      if (segment.type === "text") {
        return segment.value;
      }

      const resolved = evaluateExpression(segment.value, state);
      const str = typeof resolved === "string" ? resolved : JSON.stringify(resolved);
      return str.replace(/['"\\$`!;|&()<>{}#\n\r]/g, "\\$&");
    })
    .join("");
}

export function resolveShellBindings(value, state) {
  if (typeof value === "string" && hasTemplateExpressions(value)) {
    return resolveShellTemplate(value, state);
  }

  if (typeof value === "string" && looksLikeExpression(value)) {
    const resolved = evaluateExpression(value, state);
    return shellEscape(resolved);
  }

  return value;
}

export function looksLikeExpression(value) {
  return typeof value === "string" && /\b(?:const|inputs|steps)\./.test(value);
}

export function evaluateExpression(expression, state) {
  return evaluateAst(parseExpression(expression), state);
}

export function collectExpressionPaths(expression) {
  const ast = parseExpression(expression);
  const paths = [];

  function walk(node) {
    if (node.type === "path") {
      paths.push(node.value);
      return;
    }

    if (node.type === "unary") {
      walk(node.value);
      return;
    }

    if (node.type === "ternary") {
      walk(node.condition);
      walk(node.consequent);
      walk(node.alternate);
      return;
    }

    if (node.type === "binary") {
      walk(node.left);
      walk(node.right);
    }
  }

  walk(ast);
  return paths;
}

export function resolveBindings(value, state) {
  if (Array.isArray(value)) {
    return value.map((item) => resolveBindings(item, state));
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const resolved = {};
    for (const [key, child] of Object.entries(value)) {
      resolved[key] = resolveBindings(child, state);
    }
    return resolved;
  }

  if (typeof value === "string" && hasTemplateExpressions(value)) {
    return resolveTemplate(value, state);
  }

  if (typeof value === "string" && looksLikeExpression(value)) {
    return evaluateExpression(value, state);
  }

  return value;
}
