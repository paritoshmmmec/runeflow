import { collectExpressionPaths, collectTemplatePaths, hasTemplateExpressions, looksLikeExpression, parseExpression } from "./expression.js";
import { shapeHasPath } from "./schema.js";
import { isPlainObject } from "./utils.js";

const STEP_RUNTIME_FIELDS = new Set([
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

function getStepOutputSchema(step) {
  if (step.kind === "tool") {
    return step.out ?? null;
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

  return null;
}

function validateReferencePath(pathExpression, availableInputs, availableSteps, issues, location) {
  const segments = pathExpression.split(".");

  if (segments[0] === "inputs") {
    if (!shapeHasPath(availableInputs, segments.slice(1))) {
      issues.push(`${location}: unknown input reference '${pathExpression}'`);
    }
    return;
  }

  if (segments[0] === "steps") {
    const [, stepId, ...rest] = segments;
    const stepSchema = availableSteps.get(stepId);

    if (!stepSchema) {
      issues.push(`${location}: unknown or forward step reference '${pathExpression}'`);
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
      issues.push(`${location}: unknown step output path '${pathExpression}'`);
    }
    return;
  }

  issues.push(`${location}: unsupported reference root in '${pathExpression}'`);
}

export function validateSkill(definition) {
  const issues = [];
  const warnings = [];
  const { metadata, workflow } = definition;
  const seenStepIds = new Set();

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

    if (step.kind !== "tool" && step.kind !== "llm" && step.kind !== "branch") {
      issues.push(`step '${step.id}' has unsupported kind '${step.kind}'`);
      continue;
    }

    if (step.kind === "tool") {
      if (typeof step.tool !== "string" || !step.tool) {
        issues.push(`step '${step.id}' must declare a tool`);
      }

      if (!isPlainObject(step.out)) {
        issues.push(`step '${step.id}' must declare an out schema`);
      }
    }

    if (step.kind === "llm") {
      if (typeof step.prompt !== "string" || !step.prompt.trim()) {
        issues.push(`step '${step.id}' must declare a prompt`);
      }

      if (!isPlainObject(step.schema)) {
        issues.push(`step '${step.id}' must declare a schema`);
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
  }

  for (const step of workflow.steps) {
    const currentIndex = stepIndex.get(step.id);
    const schema = getStepOutputSchema(step);

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
        validateReferencePath(pathExpression, metadata.inputs, availableSteps, issues, reference.location);
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
      validateReferencePath(pathExpression, metadata.inputs, availableSteps, issues, reference.location);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  };
}

export const validateRuneflow = validateSkill;
