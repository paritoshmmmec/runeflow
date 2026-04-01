import { SkillSyntaxError } from "./errors.js";
import { getByPath } from "./utils.js";

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

    if (value === "and" || value === "or" || value === "not") {
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

  function parseExpressionAst() {
    const ast = parseOr();
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

    if (rest[0] in stepState && (rest[0] === "status" || rest[0] === "error" || rest[0] === "attempts")) {
      if (rest.length === 1) {
        return { found: true, value: stepState[rest[0]] };
      }

      return getByPath(stepState[rest[0]], rest.slice(1));
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

  if (node.type === "binary") {
    const left = evaluateAst(node.left, state);
    const right = evaluateAst(node.right, state);

    switch (node.operator) {
      case "==":
        return left === right;
      case "!=":
        return left !== right;
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

export function looksLikeExpression(value) {
  return typeof value === "string" && /\b(?:inputs|steps)\./.test(value);
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

    if (node.type === "binary") {
      walk(node.left);
      walk(node.right);
    }
  }

  walk(ast);
  return paths;
}
