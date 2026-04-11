import fs from "node:fs";
import path from "node:path";
import { parseRuneflow } from "./parser.js";
import { resolveWorkflowBlocks } from "./blocks.js";
import { collectExpressionPaths, collectTemplatePaths, hasTemplateExpressions, looksLikeExpression, parseExpression, STEP_STATE_FIELDS } from "./expression.js";
import { shapeHasPath } from "./schema.js";
import { getToolOutputSchema, loadToolRegistry } from "./tool-registry.js";
import { isPlainObject } from "./utils.js";

const STEP_RUNTIME_FIELDS = STEP_STATE_FIELDS;

// ─── "Did you mean?" suggestion helper ───────────────────────────────────────

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function didYouMean(input, candidates) {
  if (!candidates || candidates.length === 0) return null;
  const lower = input.toLowerCase();
  let best = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = editDistance(lower, candidate.toLowerCase());
    // Only suggest if within 40% edit distance of the longer string
    const threshold = Math.max(Math.floor(Math.max(input.length, candidate.length) * 0.4), 2);
    if (dist < bestDist && dist <= threshold) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

export function loadImportedBlocks(imports, options, seen = new Set(), issues = []) {
  const importedBlocks = new Map();
  if (!imports || imports.length === 0) return importedBlocks;

  const baseDir = options.sourcePath ? path.dirname(options.sourcePath) : process.cwd();

  for (const importDecl of imports) {
    if (importDecl.kind !== "blocks") continue;
    
    const absolutePath = path.resolve(baseDir, importDecl.path);
    if (seen.has(absolutePath)) continue;
    seen.add(absolutePath);

    if (!fs.existsSync(absolutePath)) {
      issues.push(`Imported file not found: '${importDecl.path}'`);
      continue;
    }

    let source;
    try {
      source = fs.readFileSync(absolutePath, "utf8");
    } catch (err) {
      issues.push(`Failed to read imported file '${importDecl.path}': ${err.message}`);
      continue;
    }

    let parsed;
    try {
      parsed = parseRuneflow(source, { sourcePath: absolutePath });
    } catch (err) {
      issues.push(`Failed to parse imported file '${importDecl.path}': ${err.message}`);
      continue;
    }
    
    const nestedBlocks = loadImportedBlocks(parsed.workflow.imports ?? [], { sourcePath: absolutePath }, seen, issues);
    for (const [id, block] of nestedBlocks) {
      if (!importedBlocks.has(id)) {
        importedBlocks.set(id, block);
      }
    }

    for (const block of parsed.workflow.blocks ?? []) {
      if (!importedBlocks.has(block.id)) {
        importedBlocks.set(block.id, block);
      }
    }
  }

  return importedBlocks;
}

function collectReferences(value, issues, location) {
  const references = [];

  function walk(current, currentLocation) {
    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, `${currentLocation}[${index}]`));
      return;
    }

    if (isPlainObject(current)) {
      for (const [key, child] of Object.entries(current)) {
        walk(child, `${currentLocation}.${key}`);
      }
      return;
    }

    if (typeof current === "string" && hasTemplateExpressions(current)) {
      try {
        references.push({
          expression: current,
          paths: collectTemplatePaths(current),
          location: currentLocation,
        });
      } catch (error) {
        issues.push(`${currentLocation}: ${error.message}`);
      }
      return;
    }

    if (typeof current === "string" && looksLikeExpression(current)) {
      try {
        parseExpression(current);
        references.push({
          expression: current,
          paths: collectExpressionPaths(current),
          location: currentLocation,
        });
      } catch (error) {
        issues.push(`${currentLocation}: ${error.message}`);
      }
    }
  }

  walk(value, location);
  return references;
}

function getParallelOutputSchema(step, workflow, stepIndex, toolRegistry) {
  if (step.out) {
    return step.out;
  }

  const byStep = {};
  if (workflow && stepIndex && Array.isArray(step.steps)) {
    for (const childId of step.steps) {
      const childIndex = stepIndex.get(childId);
      if (childIndex === undefined) {
        continue;
      }

      const childStep = workflow.steps[childIndex];
      if (!childStep) {
        continue;
      }

      byStep[childId] = getStepOutputSchema(childStep, toolRegistry, workflow, stepIndex) ?? "any";
    }
  }

  return {
    results: ["any"],
    by_step: byStep,
    step_ids: ["string"],
  };
}

function getStepOutputSchema(step, toolRegistry, workflow = null, stepIndex = null) {
  if (step.kind === "tool") {
    return step.out ?? getToolOutputSchema(step.tool, toolRegistry);
  }

  if (step.kind === "parallel") {
    return getParallelOutputSchema(step, workflow, stepIndex, toolRegistry);
  }

  if (step.kind === "llm") {
    return step.schema ?? null;
  }

  if (step.kind === "branch") {
    return {
      matched: "boolean",
      target: "string",
    };
  }

  if (step.kind === "transform") {
    return step.out ?? null;
  }

  if (step.kind === "cli") {
    return step.out ?? { stdout: "string", stderr: "string", exit_code: "number" };
  }

  if (step.kind === "human_input") {
    return step.out ?? { answer: "any" };
  }

  return null;
}

function validateLlmConfig(config, location, issues) {
  if (!isPlainObject(config)) {
    issues.push(`${location} must be an object`);
    return;
  }

  if (typeof config.provider !== "string" || !config.provider.trim()) {
    issues.push(`${location}.provider is required`);
  }

  const router = config.router ?? false;
  if (typeof router !== "boolean") {
    issues.push(`${location}.router must be a boolean`);
  }

  if (router !== true && (typeof config.model !== "string" || !config.model.trim())) {
    issues.push(`${location}.model is required when router is false`);
  }
}

function validateReferencePath(pathExpression, availableInputs, availableConsts, availableSteps, issues, location) {
  const segments = pathExpression.split(".");

  if (segments[0] === "const") {
    if (!shapeHasPath(availableConsts, segments.slice(1))) {
      issues.push(`${location}: unknown const reference '${pathExpression}'`);
    }
    return;
  }

  if (segments[0] === "inputs") {
    if (!shapeHasPath(availableInputs, segments.slice(1))) {
      const field = segments[1];
      const available = isPlainObject(availableInputs) ? Object.keys(availableInputs) : [];
      const suggestion = field ? didYouMean(field, available) : null;
      const hint = suggestion ? ` (did you mean 'inputs.${suggestion}'?)` : available.length ? ` (available: ${available.map((k) => `inputs.${k}`).join(", ")})` : "";
      issues.push(`${location}: unknown input reference '${pathExpression}'${hint}`);
    }
    return;
  }

  if (segments[0] === "steps") {
    const [, stepId, ...rest] = segments;
    const stepSchema = availableSteps.get(stepId);

    if (!stepSchema) {
      const availableStepIds = [...availableSteps.keys()];
      const suggestion = stepId ? didYouMean(stepId, availableStepIds) : null;
      const hint = suggestion ? ` (did you mean 'steps.${suggestion}...'?)` : availableStepIds.length ? ` (available steps: ${availableStepIds.join(", ")})` : "";
      issues.push(`${location}: unknown or forward step reference '${pathExpression}'${hint}`);
      return;
    }

    if (rest.length === 0) {
      return;
    }

    if (STEP_RUNTIME_FIELDS.has(rest[0])) {
      if (rest[0] === "outputs" && rest.length > 1 && !shapeHasPath(stepSchema, rest.slice(1))) {
        issues.push(`${location}: unknown step output path '${pathExpression}'`);
      }
      return;
    }

    if (!shapeHasPath(stepSchema, rest)) {
      const field = rest[0];
      const available = isPlainObject(stepSchema) ? Object.keys(stepSchema) : [];
      const suggestion = field ? didYouMean(field, available) : null;
      const hint = suggestion ? ` (did you mean 'steps.${stepId}.${suggestion}'?)` : available.length ? ` (available: ${available.map((k) => `steps.${stepId}.${k}`).join(", ")})` : "";
      issues.push(`${location}: unknown step output path '${pathExpression}'${hint}`);
    }
    return;
  }

  issues.push(`${location}: unsupported reference root in '${pathExpression}'`);
}

export function validateSkill(definition, options = {}) {
  const issues = [];
  const warnings = [];

  // Fall back to definition.sourcePath so relative imports resolve correctly
  // when the caller doesn't explicitly pass sourcePath in options.
  const effectiveOptions = options.sourcePath
    ? options
    : { ...options, sourcePath: definition.sourcePath ?? undefined };

  const importedBlocks = loadImportedBlocks(definition.workflow?.imports ?? [], effectiveOptions, new Set(), issues);

  let workflow;
  try {
    workflow = resolveWorkflowBlocks(definition.workflow ?? { steps: [], output: {} }, importedBlocks);
  } catch (error) {
    workflow = definition.workflow ?? { steps: [], output: {} };
    issues.push(error.message);
  }

  const { metadata } = definition;
  const consts = definition.consts ?? {};
  const seenStepIds = new Set();
  const toolRegistry = loadToolRegistry(options);
  const parallelChildren = new Map();
  const parallelChildOwners = new Map();

  if (!metadata.name) {
    issues.push("metadata.name is required");
  }

  if (!metadata.description) {
    issues.push("metadata.description is required");
  }

  if (!isPlainObject(metadata.inputs)) {
    issues.push("metadata.inputs must be an object schema");
  }

  if (!isPlainObject(metadata.outputs)) {
    issues.push("metadata.outputs must be an object schema");
  }

  if (metadata.llm !== null && metadata.llm !== undefined) {
    validateLlmConfig(metadata.llm, "metadata.llm", issues);
  }

  // Validate mcp_servers frontmatter
  if (metadata.mcp_servers !== null && metadata.mcp_servers !== undefined) {
    if (!isPlainObject(metadata.mcp_servers)) {
      issues.push("metadata.mcp_servers must be an object");
    } else {
      for (const [name, server] of Object.entries(metadata.mcp_servers)) {
        if (!isPlainObject(server)) {
          issues.push(`metadata.mcp_servers.${name} must be an object`);
          continue;
        }
        const hasCommand = typeof server.command === "string" && server.command.trim();
        const hasUrl = typeof server.url === "string" && server.url.trim();
        if (!hasCommand && !hasUrl) {
          issues.push(`metadata.mcp_servers.${name} must declare either 'command' (stdio) or 'url' (HTTP)`);
        }
        if (hasCommand && hasUrl) {
          issues.push(`metadata.mcp_servers.${name} must declare 'command' OR 'url', not both`);
        }
      }
    }
  }

  // Validate composio frontmatter
  if (metadata.composio !== null && metadata.composio !== undefined) {
    if (!isPlainObject(metadata.composio)) {
      issues.push("metadata.composio must be an object");
    } else {
      const { tools: composioTools, toolkits } = metadata.composio;
      if (composioTools !== undefined && !Array.isArray(composioTools)) {
        issues.push("metadata.composio.tools must be an array");
      }
      if (toolkits !== undefined && !Array.isArray(toolkits)) {
        issues.push("metadata.composio.toolkits must be an array");
      }
      if (!composioTools?.length && !toolkits?.length) {
        issues.push("metadata.composio must declare at least one of 'tools' or 'toolkits'");
      }
    }
  }

  if (!workflow.steps.length) {
    issues.push("workflow must declare at least one step or branch");
  }

  const stepIndex = new Map(workflow.steps.map((step, index) => [step.id, index]));
  const availableSteps = new Map();

  for (const step of workflow.steps) {
    if (seenStepIds.has(step.id)) {
      issues.push(`duplicate step id '${step.id}'`);
      continue;
    }

    seenStepIds.add(step.id);

    if (
      step.kind !== "tool"
      && step.kind !== "parallel"
      && step.kind !== "llm"
      && step.kind !== "branch"
      && step.kind !== "transform"
      && step.kind !== "cli"
      && step.kind !== "human_input"
      && step.kind !== "fail"
    ) {
      issues.push(`step '${step.id}' has unsupported kind '${step.kind}'`);
      continue;
    }

    if (step.kind === "tool") {
      if (typeof step.tool !== "string" || !step.tool) {
        issues.push(`step '${step.id}' must declare a tool`);
      }

      if (step.out !== undefined && step.out !== null && !isPlainObject(step.out)) {
        issues.push(`step '${step.id}' out must be an object schema`);
      }

      if (!step.out && !getToolOutputSchema(step.tool, toolRegistry)) {
        issues.push(`step '${step.id}' must declare an out schema or reference a registered tool with an outputSchema`);
      }
    }

    if (step.kind === "parallel") {
      if (!Array.isArray(step.steps) || step.steps.length === 0) {
        issues.push(`parallel '${step.id}' must declare a non-empty steps array`);
      } else {
        const childIds = new Set();
        for (const childId of step.steps) {
          if (typeof childId !== "string" || !childId.trim()) {
            issues.push(`parallel '${step.id}' steps must contain non-empty step ids`);
            continue;
          }

          if (childIds.has(childId)) {
            issues.push(`parallel '${step.id}' declares duplicate child step '${childId}'`);
          }
          childIds.add(childId);
        }
      }

      if (step.out !== undefined && step.out !== null && !isPlainObject(step.out)) {
        issues.push(`parallel '${step.id}' out must be an object schema`);
      }
    }

    if (step.kind === "llm") {
      if (typeof step.prompt !== "string" || !step.prompt.trim()) {
        issues.push(`step '${step.id}' must declare a prompt`);
      }

      if (!isPlainObject(step.schema)) {
        issues.push(`step '${step.id}' must declare a schema`);
      }

      if (step.docs !== undefined && step.docs !== null) {
        const docBlocks = definition.docBlocks ?? {};
        if (typeof step.docs !== "string" || !step.docs.trim()) {
          issues.push(`step '${step.id}' docs must be a non-empty string`);
        } else if (!Object.prototype.hasOwnProperty.call(docBlocks, step.docs)) {
          issues.push(`step '${step.id}' docs references unknown block '${step.docs}'`);
        }
      }

      if (step.llm !== undefined && step.llm !== null) {
        validateLlmConfig(step.llm, `step '${step.id}' llm`, issues);
      }
    } else if (step.llm !== undefined && step.llm !== null) {
      issues.push(`step '${step.id}' may only declare llm config when kind is 'llm'`);
    }

    if (step.kind === "transform") {
      if (typeof step.expr !== "string" || !step.expr.trim()) {
        issues.push(`step '${step.id}' must declare an expr`);
      }
      if (!isPlainObject(step.out) && !Array.isArray(step.out)) {
        issues.push(`step '${step.id}' must declare an out schema`);
      }
    }

    if (step.kind === "cli") {
      if (typeof step.command !== "string" || !step.command.trim()) {
        issues.push(`step '${step.id}' must declare a command`);
      }
    }

    // Cross-check mcp.* tool references against frontmatter mcp_servers declarations
    // Only validate if the skill explicitly declares mcp_servers in frontmatter
    if (step.kind === "tool" && typeof step.tool === "string") {
      const parts = step.tool.split(".");
      if (parts[0] === "mcp" && parts[1] && metadata.mcp_servers !== null && metadata.mcp_servers !== undefined) {
        const declared = metadata.mcp_servers ?? {};
        if (!Object.prototype.hasOwnProperty.call(declared, parts[1])) {
          issues.push(`step '${step.id}' references MCP server '${parts[1]}' but it is not declared in mcp_servers`);
        }
      }
    }

    if (step.kind === "human_input") {
      if (typeof step.prompt !== "string" || !step.prompt.trim()) {
        issues.push(`step '${step.id}' must declare a prompt`);
      }

      if (step.choices !== undefined) {
        if (!Array.isArray(step.choices) || step.choices.length === 0) {
          issues.push(`step '${step.id}' choices must be a non-empty array when provided`);
        } else if (step.choices.some((choice) => typeof choice !== "string")) {
          issues.push(`step '${step.id}' choices must contain only strings`);
        }
      }

      if (step.out !== undefined && step.out !== null && !isPlainObject(step.out)) {
        issues.push(`step '${step.id}' out must be an object schema`);
      }
    }

    if (step.kind === "branch") {
      if (typeof step.if !== "string") {
        issues.push(`branch '${step.id}' must declare an if expression`);
      }

      if (typeof step.then !== "string") {
        issues.push(`branch '${step.id}' must declare a then target`);
      }

      if (typeof step.else !== "string") {
        issues.push(`branch '${step.id}' must declare an else target`);
      }
    }

    if (step.retry !== undefined && (!Number.isInteger(step.retry) || step.retry < 0)) {
      issues.push(`step '${step.id}' retry must be a non-negative integer`);
    }

    if (step.retry_delay !== undefined && (typeof step.retry_delay !== "number" || step.retry_delay < 0)) {
      issues.push(`step '${step.id}' retry_delay must be a non-negative number (milliseconds)`);
    }

    if (step.retry_backoff !== undefined && !["linear", "exponential"].includes(step.retry_backoff)) {
      issues.push(`step '${step.id}' retry_backoff must be 'linear' or 'exponential'`);
    }

    if (step.retry_delay !== undefined && step.retry === undefined) {
      issues.push(`step '${step.id}' retry_delay requires retry to be set`);
    }

    if (step.skip_if !== undefined && typeof step.skip_if !== "string") {
      issues.push(`step '${step.id}' skip_if must be an expression string`);
    }
  }

  const llmSteps = workflow.steps.filter((step) => step.kind === "llm");
  if (llmSteps.length > 0 && !metadata.llm && llmSteps.some((step) => !step.llm)) {
    issues.push("metadata.llm is required when llm steps do not declare their own llm config");
  }

  for (const step of workflow.steps) {
    if (step.kind !== "parallel" || !Array.isArray(step.steps)) {
      continue;
    }

    const currentIndex = stepIndex.get(step.id);
    const followingIds = workflow.steps
      .slice(currentIndex + 1, currentIndex + 1 + step.steps.length)
      .map((childStep) => childStep.id);

    if (followingIds.length !== step.steps.length || followingIds.join(",") !== step.steps.join(",")) {
      issues.push(
        `parallel '${step.id}' child steps must be declared immediately after the parallel block in matching order`,
      );
    }

    parallelChildren.set(step.id, new Set(step.steps));

    for (const childId of step.steps) {
      const childIndex = stepIndex.get(childId);

      if (childIndex === undefined) {
        issues.push(`parallel '${step.id}' references unknown child step '${childId}'`);
        continue;
      }

      if (childIndex <= currentIndex) {
        issues.push(`parallel '${step.id}' child step '${childId}' must point forward`);
        continue;
      }

      if (parallelChildOwners.has(childId)) {
        issues.push(
          `parallel child step '${childId}' is already owned by parallel '${parallelChildOwners.get(childId)}'`,
        );
        continue;
      }

      parallelChildOwners.set(childId, step.id);

      const childStep = workflow.steps[childIndex];
      const PARALLEL_ALLOWED_KINDS = new Set(["tool", "llm", "cli"]);
      if (!PARALLEL_ALLOWED_KINDS.has(childStep.kind)) {
        issues.push(`parallel '${step.id}' child step '${childId}' must be a tool, llm, or cli step`);
      }

      if (childStep.kind === "llm" && !childStep.schema && !childStep.llm?.schema) {
        issues.push(`parallel '${step.id}' child llm step '${childId}' must declare a schema`);
      }

      if (childStep.next) {
        issues.push(`parallel child step '${childId}' may not declare next`);
      }

      if (childStep.fallback) {
        issues.push(`parallel child step '${childId}' may not declare fallback`);
      }
    }
  }

  for (const step of workflow.steps) {
    const currentIndex = stepIndex.get(step.id);
    const schema = getStepOutputSchema(step, toolRegistry, workflow, stepIndex);

    const targetPairs = [];

    if (step.kind === "branch") {
      targetPairs.push(["then", step.then], ["else", step.else]);
    } else {
      if (step.next) {
        targetPairs.push(["next", step.next]);
      }
      if (step.fallback) {
        targetPairs.push(["fallback", step.fallback]);
      }
    }

    for (const [label, target] of targetPairs) {
      if (target === null || target === undefined || target === "fail") {
        continue;
      }

      if (!stepIndex.has(target)) {
        issues.push(`step '${step.id}' ${label} target '${target}' does not exist`);
        continue;
      }

      if (parallelChildOwners.has(target)) {
        issues.push(`step '${step.id}' ${label} target '${target}' may not point to a parallel child step`);
        continue;
      }

      if (stepIndex.get(target) <= currentIndex) {
        issues.push(`step '${step.id}' ${label} target '${target}' must point forward`);
      }
    }

    const references = [];

    if (step.kind === "tool") {
      references.push(...collectReferences(step.with ?? {}, issues, `step '${step.id}' with`));
    }

    if (step.kind === "llm") {
      references.push(...collectReferences(step.prompt ?? "", issues, `step '${step.id}' prompt`));
      references.push(...collectReferences(step.input ?? {}, issues, `step '${step.id}' input`));
    }

    if (step.kind === "human_input") {
      references.push(...collectReferences(step.prompt ?? "", issues, `step '${step.id}' prompt`));
      references.push(...collectReferences(step.choices ?? [], issues, `step '${step.id}' choices`));
      references.push(...collectReferences(step.default, issues, `step '${step.id}' default`));
    }

    if (step.kind === "transform") {
      references.push(...collectReferences(step.input ?? {}, issues, `step '${step.id}' input`));
    }

    if (step.kind === "cli" && step.command) {
      references.push(...collectReferences(step.command, issues, `step '${step.id}' command`));
    }

    if (step.failMessage) {
      references.push(...collectReferences(step.failMessage, issues, `step '${step.id}' fail_message`));
    }

    if (step.kind === "branch" && typeof step.if === "string") {
      try {
        references.push({
          expression: step.if,
          paths: collectExpressionPaths(step.if),
          location: `branch '${step.id}' if`,
        });
      } catch (error) {
        issues.push(`branch '${step.id}' if: ${error.message}`);
      }
    }

    for (const reference of references) {
      for (const pathExpression of reference.paths) {
        validateReferencePath(pathExpression, metadata.inputs, consts, availableSteps, issues, reference.location);

        const ownerId = parallelChildOwners.get(step.id);
        if (!ownerId || !pathExpression.startsWith("steps.")) {
          continue;
        }

        const referencedStepId = pathExpression.split(".")[1];
        const groupIds = parallelChildren.get(ownerId) ?? new Set();
        if (referencedStepId === ownerId || groupIds.has(referencedStepId)) {
          issues.push(
            `${reference.location}: parallel child step '${step.id}' may not reference sibling step '${referencedStepId}'`,
          );
        }
      }
    }

    // validate skip_if references
    if (step.skip_if && typeof step.skip_if === "string") {
      try {
        const skipPaths = collectExpressionPaths(step.skip_if);
        for (const pathExpression of skipPaths) {
          validateReferencePath(pathExpression, metadata.inputs, consts, availableSteps, issues, `step '${step.id}' skip_if`);
        }
      } catch (error) {
        issues.push(`step '${step.id}' skip_if: ${error.message}`);
      }
    }

    if (schema) {
      availableSteps.set(step.id, schema);
    } else {
      warnings.push(`step '${step.id}' does not expose an output schema`);
    }
  }

  const outputRefs = collectReferences(workflow.output, issues, "output");
  for (const reference of outputRefs) {
    for (const pathExpression of reference.paths) {
      validateReferencePath(pathExpression, metadata.inputs, consts, availableSteps, issues, reference.location);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  };
}

export const validateRuneflow = validateSkill;
