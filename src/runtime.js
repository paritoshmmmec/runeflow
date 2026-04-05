import fs from "node:fs/promises";
import path from "node:path";
import { createBuiltinTools } from "./builtins.js";
import { RuntimeError, ValidationError } from "./errors.js";
import { evaluateExpression, hasTemplateExpressions, looksLikeExpression, resolveTemplate } from "./expression.js";
import { validateShape } from "./schema.js";
import { getToolOutputSchema, loadToolRegistry } from "./tool-registry.js";
import { deepClone, ensureDir, isPlainObject, serializeError } from "./utils.js";
import { validateSkill } from "./validator.js";

const DEFAULT_RUNS_DIR = ".runeflow-runs";

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

  if (typeof value === "string" && hasTemplateExpressions(value)) {
    return resolveTemplate(value, state);
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

async function writeStepArtifact(runId, stepRun, runsDir) {
  const stepArtifactsDir = path.join(runsDir, runId, "steps");
  await ensureDir(stepArtifactsDir);
  const artifactPath = path.join(stepArtifactsDir, `${stepRun.id}.json`);
  await fs.writeFile(artifactPath, JSON.stringify(stepRun, null, 2));
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

function projectLlmContext(definition, step) {
  const docs = step.docs
    ? (definition.docBlocks?.[step.docs] ?? definition.docs)
    : definition.docs;
  return {
    docs,
    metadata: deepClone(definition.metadata),
    source_path: definition.sourcePath ?? null,
  };
}

function createRuntime(runtime = {}, options = {}) {
  return {
    ...runtime,
    tools: {
      ...createBuiltinTools({ cwd: options.cwd }),
      ...(runtime.tools ?? {}),
    },
  };
}

function resolveLlmConfig(definition, step) {
  return step.llm ?? definition.metadata.llm ?? null;
}

async function invokeLlm(definition, step, resolvedPrompt, resolvedInput, runtime, state) {
  const llmConfig = resolveLlmConfig(definition, step);

  if (!llmConfig) {
    throw new RuntimeError(`Step '${step.id}' has no llm configuration.`);
  }

  const provider = llmConfig.provider;
  const handler = runtime.llms?.[provider];

  if (typeof handler !== "function") {
    throw new RuntimeError(`No LLM handler registered for provider '${provider}'.`);
  }

  const context = projectLlmContext(definition, step);

  return handler({
    step,
    llm: deepClone(llmConfig),
    prompt: resolvedPrompt,
    input: resolvedInput,
    schema: step.schema,
    state,
    docs: context.docs,
    context,
  });
}

function failRun(run, message, error = null) {
  run.status = "failed";
  run.error = error ? serializeError(error) : { name: "RuntimeError", message, stack: null };
  run.finished_at = new Date().toISOString();
}

async function callHook(hookFn, payload, hookEvents) {
  if (typeof hookFn !== "function") return undefined;
  const event = { hook: hookFn.name || "hook", payload, result: null, error: null };
  try {
    event.result = await hookFn(payload) ?? null;
  } catch (error) {
    event.error = serializeError(error);
  }
  hookEvents.push(event);
  return event.result;
}

function inferBranchOutput(conditionResult, target) {
  return {
    matched: Boolean(conditionResult),
    target,
  };
}

export async function runSkill(definition, inputs, runtime = {}, options = {}) {
  const toolRegistry = loadToolRegistry(options);
  const validation = validateSkill(definition, options);
  if (!validation.valid) {
    throw new ValidationError("Skill validation failed.", validation.issues);
  }

  const runsDir = options.runsDir ?? path.resolve(process.cwd(), DEFAULT_RUNS_DIR);
  const effectiveRuntime = createRuntime(runtime, options);
  const run = {
    run_id: createRunId(),
    runeflow: {
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
    let resolvedPrompt = null;
    const hookEvents = [];

    const beforeResult = await callHook(effectiveRuntime.hooks?.beforeStep, {
      runId: run.run_id,
      step,
      state,
    }, hookEvents);

    if (beforeResult?.abort) {
      failRun(run, beforeResult.reason ?? `beforeStep aborted step '${step.id}'.`);
      run.outputs = {};
      run.artifact_path = await writeRunArtifact(run, runsDir);
      return run;
    }

    while (attempts <= (step.retry ?? 0)) {
      attempts += 1;

      try {
        if (step.kind === "tool") {
          resolvedInput = resolveBindings(step.with ?? {}, state);
          finalOutputs = await invokeTool(step, resolvedInput, effectiveRuntime, state);
          const toolOutputSchema = step.out ?? getToolOutputSchema(step.tool, toolRegistry);
          const issues = validateShape(finalOutputs, toolOutputSchema, `steps.${step.id}`);
          if (issues.length) {
            throw new RuntimeError(`Tool output failed validation: ${issues.join("; ")}`);
          }
        } else if (step.kind === "llm") {
          resolvedPrompt = resolveBindings(step.prompt, state);
          resolvedInput = resolveBindings(step.input ?? {}, state);
          finalOutputs = await invokeLlm(definition, step, resolvedPrompt, resolvedInput, effectiveRuntime, state);
          const issues = validateShape(finalOutputs, step.schema, `steps.${step.id}`);
          if (issues.length) {
            throw new RuntimeError(`LLM output failed validation: ${issues.join("; ")}`);
          }
          resolvedPrompt = resolvedPrompt; // captured for artifact
        } else if (step.kind === "branch") {
          const matched = evaluateExpression(step.if, state);
          const target = matched ? step.then : step.else;
          finalOutputs = inferBranchOutput(matched, target);
        } else if (step.kind === "transform") {
          const resolvedTransformInput = resolveBindings(step.input, state);
          try {
            // eslint-disable-next-line no-new-func
            finalOutputs = new Function("input", `return (${step.expr})`)(resolvedTransformInput);
          } catch (error) {
            throw new RuntimeError(`transform '${step.id}' expression failed: ${error.message}`);
          }
          const issues = validateShape(finalOutputs, step.out, `steps.${step.id}`);
          if (issues.length) {
            throw new RuntimeError(`Transform output failed validation: ${issues.join("; ")}`);
          }
        } else {
          throw new RuntimeError(`Unsupported step kind '${step.kind}'.`);
        }

        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      await callHook(effectiveRuntime.hooks?.onStepError, {
        runId: run.run_id,
        step,
        error: serializeError(lastError),
        attempts,
        state,
      }, hookEvents);
    }

    const stepRun = {
      id: step.id,
      kind: step.kind,
      status: lastError ? "failed" : "success",
      attempts,
      inputs: deepClone(resolvedInput),
      outputs: lastError ? null : deepClone(finalOutputs),
      error: lastError ? serializeError(lastError) : null,
      projected_docs: step.kind === "llm" ? (step.docs
        ? (definition.docBlocks?.[step.docs] ?? definition.docs)
        : definition.docs) : undefined,
      hook_events: hookEvents,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };

    run.steps.push(stepRun);

    await callHook(effectiveRuntime.hooks?.afterStep, {
      runId: run.run_id,
      step,
      stepRun: deepClone(stepRun),
      state,
    }, hookEvents);

    if (!stepRun.hook_events.length) stepRun.hook_events = undefined;
    stepRun.artifact_path = await writeStepArtifact(run.run_id, stepRun, runsDir);
    stepRun.result_path = stepRun.artifact_path;

    if (lastError) {
      const resolvedFailMessage = step.failMessage ? resolveBindings(step.failMessage, state) : null;
      if (!step.fallback || step.fallback === "fail") {
        failRun(run, resolvedFailMessage ?? lastError.message, lastError);
        run.outputs = {};
        run.artifact_path = await writeRunArtifact(run, runsDir);
        return run;
      }

      index = stepIndex.get(step.fallback);
      continue;
    }

    if (step.kind === "branch") {
      if (finalOutputs.target === "fail") {
        const resolvedFailMessage = step.failMessage ? resolveBindings(step.failMessage, state) : null;
        failRun(run, resolvedFailMessage ?? `Branch '${step.id}' selected fail target.`);
        run.outputs = {};
        run.artifact_path = await writeRunArtifact(run, runsDir);
        return run;
      }

      index = stepIndex.get(finalOutputs.target);
      continue;
    }

    if (step.next === "fail") {
      const resolvedFailMessage = step.failMessage ? resolveBindings(step.failMessage, state) : null;
      failRun(run, resolvedFailMessage ?? `Step '${step.id}' terminated the run.`);
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

export const runRuneflow = runSkill;
