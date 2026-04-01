import fs from "node:fs/promises";
import path from "node:path";
import { RuntimeError, ValidationError } from "./errors.js";
import { evaluateExpression, looksLikeExpression } from "./expression.js";
import { validateShape } from "./schema.js";
import { deepClone, ensureDir, isPlainObject, serializeError } from "./utils.js";
import { validateSkill } from "./validator.js";

function createRunId() {
  const now = new Date();
  const compact = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `run_${compact}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveBindings(value, state) {
  if (Array.isArray(value)) {
    return value.map((item) => resolveBindings(item, state));
  }

  if (isPlainObject(value)) {
    const resolved = {};
    for (const [key, child] of Object.entries(value)) {
      resolved[key] = resolveBindings(child, state);
    }
    return resolved;
  }

  if (typeof value === "string" && looksLikeExpression(value)) {
    return evaluateExpression(value, state);
  }

  return value;
}

async function writeRunArtifact(run, runsDir) {
  await ensureDir(runsDir);
  const artifactPath = path.join(runsDir, `${run.run_id}.json`);
  await fs.writeFile(artifactPath, JSON.stringify(run, null, 2));
  return artifactPath;
}

function buildStepState(stepRuns) {
  return Object.fromEntries(stepRuns.map((stepRun) => [stepRun.id, stepRun]));
}

async function invokeTool(step, resolvedInput, runtime, state) {
  const tool = runtime.tools?.[step.tool];

  if (!tool) {
    throw new RuntimeError(`Tool '${step.tool}' is not registered.`);
  }

  return tool(resolvedInput, {
    step,
    state,
  });
}

async function invokeLlm(step, resolvedInput, runtime, state) {
  if (typeof runtime.llm !== "function") {
    throw new RuntimeError("No LLM handler registered for llm steps.");
  }

  return runtime.llm({
    step,
    prompt: step.prompt,
    input: resolvedInput,
    schema: step.schema,
    state,
  });
}

function failRun(run, message, error = null) {
  run.status = "failed";
  run.error = error ? serializeError(error) : { name: "RuntimeError", message, stack: null };
  run.finished_at = new Date().toISOString();
}

function inferBranchOutput(conditionResult, target) {
  return {
    matched: Boolean(conditionResult),
    target,
  };
}

export async function runSkill(definition, inputs, runtime = {}, options = {}) {
  const validation = validateSkill(definition);
  if (!validation.valid) {
    throw new ValidationError("Skill validation failed.", validation.issues);
  }

  const runsDir = options.runsDir ?? path.resolve(process.cwd(), ".skill-runs");
  const run = {
    run_id: createRunId(),
    skill: {
      name: definition.metadata.name,
      version: definition.metadata.version,
    },
    status: "running",
    inputs: deepClone(inputs),
    steps: [],
    outputs: {},
    started_at: new Date().toISOString(),
    finished_at: null,
    error: null,
  };

  const stepIndex = new Map(definition.workflow.steps.map((step, index) => [step.id, index]));
  let index = 0;

  while (index < definition.workflow.steps.length) {
    const step = definition.workflow.steps[index];
    const state = {
      inputs,
      stepMap: buildStepState(run.steps),
    };

    let attempts = 0;
    let lastError = null;
    let finalOutputs = null;
    let resolvedInput = {};

    while (attempts <= (step.retry ?? 0)) {
      attempts += 1;

      try {
        if (step.kind === "tool") {
          resolvedInput = resolveBindings(step.with ?? {}, state);
          finalOutputs = await invokeTool(step, resolvedInput, runtime, state);
          const issues = validateShape(finalOutputs, step.out, `steps.${step.id}`);
          if (issues.length) {
            throw new RuntimeError(`Tool output failed validation: ${issues.join("; ")}`);
          }
        } else if (step.kind === "llm") {
          resolvedInput = resolveBindings(step.input ?? {}, state);
          finalOutputs = await invokeLlm(step, resolvedInput, runtime, state);
          const issues = validateShape(finalOutputs, step.schema, `steps.${step.id}`);
          if (issues.length) {
            throw new RuntimeError(`LLM output failed validation: ${issues.join("; ")}`);
          }
        } else if (step.kind === "branch") {
          const matched = evaluateExpression(step.if, state);
          const target = matched ? step.then : step.else;
          finalOutputs = inferBranchOutput(matched, target);
        } else {
          throw new RuntimeError(`Unsupported step kind '${step.kind}'.`);
        }

        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    const stepRun = {
      id: step.id,
      kind: step.kind,
      status: lastError ? "failed" : "success",
      attempts,
      inputs: deepClone(resolvedInput),
      outputs: lastError ? null : deepClone(finalOutputs),
      error: lastError ? serializeError(lastError) : null,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };

    run.steps.push(stepRun);

    if (lastError) {
      if (!step.fallback || step.fallback === "fail") {
        failRun(run, step.failMessage ?? lastError.message, lastError);
        run.outputs = {};
        run.artifact_path = await writeRunArtifact(run, runsDir);
        return run;
      }

      index = stepIndex.get(step.fallback);
      continue;
    }

    if (step.kind === "branch") {
      if (finalOutputs.target === "fail") {
        failRun(run, step.failMessage ?? `Branch '${step.id}' selected fail target.`);
        run.outputs = {};
        run.artifact_path = await writeRunArtifact(run, runsDir);
        return run;
      }

      index = stepIndex.get(finalOutputs.target);
      continue;
    }

    if (step.next === "fail") {
      failRun(run, step.failMessage ?? `Step '${step.id}' terminated the run.`);
      run.outputs = {};
      run.artifact_path = await writeRunArtifact(run, runsDir);
      return run;
    }

    if (step.next) {
      index = stepIndex.get(step.next);
      continue;
    }

    index += 1;
  }

  const finalState = {
    inputs,
    stepMap: buildStepState(run.steps),
  };

  run.outputs = resolveBindings(definition.workflow.output, finalState);
  const outputIssues = validateShape(run.outputs, definition.metadata.outputs, "outputs");
  if (outputIssues.length) {
    failRun(run, `Final outputs failed validation: ${outputIssues.join("; ")}`);
    run.outputs = {};
  } else {
    run.status = "success";
    run.finished_at = new Date().toISOString();
  }

  run.artifact_path = await writeRunArtifact(run, runsDir);
  return run;
}
