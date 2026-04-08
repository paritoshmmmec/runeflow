import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveWorkflowBlocks } from "./blocks.js";
import { checkAuth } from "./auth.js";
import { createBuiltinTools } from "./builtins.js";
import { RuntimeError, ValidationError } from "./errors.js";
import { evaluateExpression, hasTemplateExpressions, looksLikeExpression, resolveTemplate } from "./expression.js";
import { validateShape } from "./schema.js";
import { getToolOutputSchema, getToolInputSchema, loadToolRegistry } from "./tool-registry.js";
import { deepClone, ensureDir, isPlainObject, serializeError } from "./utils.js";
import { validateSkill } from "./validator.js";

const DEFAULT_RUNS_DIR = ".runeflow-runs";
const DEFAULT_PARALLEL_OUTPUT_SCHEMA = {
  results: ["any"],
  by_step: "object",
  step_ids: ["string"],
};

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

function haltRun(run, stepId, message, error = null) {
  run.status = "halted_on_error";
  run.halted_step_id = stepId;
  run.error = error ? serializeError(error) : { name: "RuntimeError", message, stack: null };
  run.finished_at = new Date().toISOString();
}

function hashStepInputs(resolvedInput) {
  const stable = JSON.stringify(resolvedInput, Object.keys(resolvedInput ?? {}).sort());
  return crypto.createHash("sha256").update(stable).digest("hex");
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

const execFileAsync = promisify(execFile);

async function invokeCliStep(step, resolvedCommand, options) {
  const cwd = options.cwd ?? process.cwd();
  const timeout = step.timeout ?? 30_000;

  try {
    const { stdout, stderr } = await execFileAsync(
      process.platform === "win32" ? "cmd" : "sh",
      process.platform === "win32" ? ["/c", resolvedCommand] : ["-c", resolvedCommand],
      { cwd, timeout, maxBuffer: 10 * 1024 * 1024 },
    );
    return {
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      exit_code: 0,
    };
  } catch (error) {
    // execFile rejects on non-zero exit — capture it as a structured output
    if (typeof error.code === "number") {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        exit_code: error.code,
      };
    }
    throw new RuntimeError(`cli step '${step.id}' failed to execute: ${error.message}`);
  }
}

function buildState(inputs, stepRuns, consts = {}) {
  return {
    inputs,
    stepMap: buildStepState(stepRuns),
    consts,
  };
}

function getRuntimeStepOutputSchema(step, toolRegistry) {
  if (step.kind === "tool") {
    return step.out ?? getToolOutputSchema(step.tool, toolRegistry);
  }

  if (step.kind === "llm") {
    return step.schema;
  }

  if (step.kind === "transform") {
    return step.out;
  }

  if (step.kind === "cli") {
    return step.out ?? { stdout: "string", stderr: "string", exit_code: "number" };
  }

  if (step.kind === "human_input") {
    return step.out ?? { answer: "any" };
  }

  return null;
}

function resolveStepCacheInput(step, state) {
  if (step.kind === "tool") {
    return resolveBindings(step.with ?? {}, state);
  }

  if (step.kind === "llm") {
    return {
      prompt: resolveBindings(step.prompt, state),
      input: resolveBindings(step.input ?? {}, state),
    };
  }

  if (step.kind === "branch") {
    return {
      matched: evaluateExpression(step.if, state),
    };
  }

  if (step.kind === "transform") {
    return resolveBindings(step.input, state);
  }

  if (step.kind === "cli") {
    return {
      command: resolveBindings(step.command, state),
    };
  }

  if (step.kind === "human_input") {
    return {
      prompt: resolveBindings(step.prompt, state),
      choices: step.choices !== undefined ? resolveBindings(step.choices, state) : undefined,
      default: step.default !== undefined ? resolveBindings(step.default, state) : undefined,
    };
  }

  return {};
}

function createCachedStepRun(step, status, resolvedInput, outputs, inputHash = undefined) {
  return {
    id: step.id,
    kind: step.kind,
    status,
    attempts: 0,
    inputs: deepClone(resolvedInput),
    outputs: outputs === undefined ? null : deepClone(outputs),
    error: null,
    input_hash: inputHash,
    cached: true,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  };
}

async function finalizeStepRun({
  definition,
  step,
  stepRun,
  state,
  effectiveRuntime,
  runId,
  runsDir,
  useHooks = true,
}) {
  if (useHooks) {
    await callHook(effectiveRuntime.hooks?.afterStep, {
      runId,
      step,
      stepRun: deepClone(stepRun),
      state,
    }, stepRun.hook_events);
  }

  if (!stepRun.hook_events?.length) {
    stepRun.hook_events = undefined;
  }

  if (
    step.kind === "llm"
    && stepRun.projected_docs === undefined
    && stepRun.status !== "skipped"
  ) {
    stepRun.projected_docs = step.docs
      ? (definition.docBlocks?.[step.docs] ?? definition.docs)
      : definition.docs;
  }

  stepRun.artifact_path = await writeStepArtifact(runId, stepRun, runsDir);
  stepRun.result_path = stepRun.artifact_path;
  return stepRun;
}

async function executeStep({
  definition,
  step,
  state,
  runId,
  runsDir,
  effectiveRuntime,
  toolRegistry,
  options,
  useHooks = true,
}) {
  if (step.skip_if && evaluateExpression(step.skip_if, state)) {
    const skippedRun = await finalizeStepRun({
      definition,
      step,
      state,
      effectiveRuntime,
      runId,
      runsDir,
      useHooks,
      stepRun: {
        id: step.id,
        kind: step.kind,
        status: "skipped",
        attempts: 0,
        inputs: {},
        outputs: null,
        error: null,
        hook_events: [],
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      },
    });

    return { stepRun: skippedRun, outputs: null, error: null, waitingForInput: null };
  }

  if (step.cache !== false && options.priorSteps && !options.force) {
    const priorStep = options.priorSteps[step.id];

    if (priorStep?.status === "skipped") {
      const cachedRun = await finalizeStepRun({
        definition,
        step,
        state,
        effectiveRuntime,
        runId,
        runsDir,
        useHooks: false,
        stepRun: createCachedStepRun(step, "skipped", {}, null),
      });

      return { stepRun: cachedRun, outputs: null, error: null, waitingForInput: null };
    }

    if (priorStep?.status === "success" && priorStep.input_hash) {
      const preResolvedInput = resolveStepCacheInput(step, state);
      const currentHash = hashStepInputs(preResolvedInput ?? {});
      if (currentHash === priorStep.input_hash) {
        const cachedRun = await finalizeStepRun({
          definition,
          step,
          state,
          effectiveRuntime,
          runId,
          runsDir,
          useHooks: false,
          stepRun: createCachedStepRun(
            step,
            "success",
            preResolvedInput ?? {},
            priorStep.outputs,
            currentHash,
          ),
        });

        return {
          stepRun: cachedRun,
          outputs: deepClone(priorStep.outputs),
          error: null,
          waitingForInput: null,
        };
      }
    }
  }

  const hookEvents = [];
  if (useHooks) {
    const beforeResult = await callHook(effectiveRuntime.hooks?.beforeStep, {
      runId,
      step,
      state,
    }, hookEvents);

    if (beforeResult?.abort) {
      return {
        abortRun: {
          reason: beforeResult.reason ?? `beforeStep aborted step '${step.id}'.`,
        },
      };
    }
  }

  const startedAt = new Date().toISOString();
  let attempts = 0;
  let lastError = null;
  let finalOutputs = null;
  let resolvedInput = {};
  let resolvedPrompt = null;
  let waitingForInput = null;
  let resolvedChoices;
  let resolvedDefault;

  while (attempts <= (step.retry ?? 0)) {
    attempts += 1;

    try {
      if (step.kind === "tool") {
        resolvedInput = resolveBindings(step.with ?? {}, state);
        const toolInputSchema = getToolInputSchema(step.tool, toolRegistry);
        if (toolInputSchema) {
          const inputIssues = validateShape(resolvedInput, toolInputSchema, `steps.${step.id} with`);
          if (inputIssues.length) {
            throw new RuntimeError(`Tool input failed validation: ${inputIssues.join("; ")}`);
          }
        }

        finalOutputs = await invokeTool(step, resolvedInput, effectiveRuntime, state);
        const toolOutputSchema = getRuntimeStepOutputSchema(step, toolRegistry);
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
      } else if (step.kind === "branch") {
        resolvedInput = {
          matched: evaluateExpression(step.if, state),
        };
        const target = resolvedInput.matched ? step.then : step.else;
        finalOutputs = inferBranchOutput(resolvedInput.matched, target);
      } else if (step.kind === "transform") {
        if (process.env.RUNEFLOW_DISABLE_TRANSFORM === "1") {
          throw new RuntimeError("Transform steps are disabled (RUNEFLOW_DISABLE_TRANSFORM=1).");
        }
        resolvedInput = resolveBindings(step.input, state);
        try {
          // eslint-disable-next-line no-new-func
          finalOutputs = new Function("input", `return (${step.expr})`)(resolvedInput);
        } catch (error) {
          throw new RuntimeError(`transform '${step.id}' expression failed: ${error.message}`);
        }
        const issues = validateShape(finalOutputs, step.out, `steps.${step.id}`);
        if (issues.length) {
          throw new RuntimeError(`Transform output failed validation: ${issues.join("; ")}`);
        }
      } else if (step.kind === "cli") {
        resolvedPrompt = resolveBindings(step.command, state);
        if (typeof resolvedPrompt !== "string" || !resolvedPrompt.trim()) {
          throw new RuntimeError(`cli step '${step.id}' command resolved to an empty string.`);
        }
        resolvedInput = { command: resolvedPrompt };
        finalOutputs = await invokeCliStep(step, resolvedPrompt, options);
        if (finalOutputs.exit_code !== 0 && step.allow_failure !== true) {
          throw new RuntimeError(
            `cli step '${step.id}' exited with code ${finalOutputs.exit_code}.\n`
            + `stderr: ${finalOutputs.stderr || "(empty)"}`,
          );
        }
        const issues = validateShape(finalOutputs, getRuntimeStepOutputSchema(step, toolRegistry), `steps.${step.id}`);
        if (issues.length) {
          throw new RuntimeError(`cli output failed validation: ${issues.join("; ")}`);
        }
      } else if (step.kind === "human_input") {
        resolvedPrompt = resolveBindings(step.prompt, state);
        resolvedChoices = step.choices !== undefined ? resolveBindings(step.choices, state) : undefined;
        resolvedDefault = step.default !== undefined ? resolveBindings(step.default, state) : undefined;
        resolvedInput = {
          prompt: resolvedPrompt,
          choices: resolvedChoices,
          default: resolvedDefault,
        };

        const promptValues = options.promptValues ?? {};
        let hasAnswer = Object.prototype.hasOwnProperty.call(promptValues, step.id);
        let answer = hasAnswer ? promptValues[step.id] : undefined;

        if (!hasAnswer && typeof options.promptHandler === "function") {
          answer = await options.promptHandler({
            step,
            prompt: resolvedPrompt,
            choices: resolvedChoices,
            defaultValue: resolvedDefault,
            state,
          });
          hasAnswer = answer !== undefined;
        }

        if (!hasAnswer && resolvedDefault !== undefined) {
          answer = resolvedDefault;
          hasAnswer = true;
        }

        if (!hasAnswer) {
          waitingForInput = {
            prompt: resolvedPrompt,
            choices: resolvedChoices,
            default: resolvedDefault,
          };
          break;
        }

        if (resolvedChoices && !resolvedChoices.includes(answer)) {
          throw new RuntimeError(
            `human_input step '${step.id}' answer must be one of: ${resolvedChoices.join(", ")}`,
          );
        }

        finalOutputs = { answer };
        const issues = validateShape(finalOutputs, getRuntimeStepOutputSchema(step, toolRegistry), `steps.${step.id}`);
        if (issues.length) {
          throw new RuntimeError(`human_input output failed validation: ${issues.join("; ")}`);
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

  if (lastError && useHooks) {
    await callHook(effectiveRuntime.hooks?.onStepError, {
      runId,
      step,
      error: serializeError(lastError),
      attempts,
      state,
    }, hookEvents);
  }

  const stepRun = await finalizeStepRun({
    definition,
    step,
    state,
    effectiveRuntime,
    runId,
    runsDir,
    useHooks,
    stepRun: {
      id: step.id,
      kind: step.kind,
      status: waitingForInput ? "waiting_for_input" : (lastError ? "failed" : "success"),
      attempts,
      inputs: deepClone(resolvedInput),
      outputs: lastError || waitingForInput ? null : deepClone(finalOutputs),
      error: lastError ? serializeError(lastError) : null,
      input_hash: step.cache !== false ? hashStepInputs(resolvedInput ?? {}) : undefined,
      projected_docs: step.kind === "llm" ? undefined : undefined,
      prompt: waitingForInput ? resolvedPrompt : undefined,
      choices: waitingForInput ? deepClone(resolvedChoices) : undefined,
      default_value: waitingForInput ? deepClone(resolvedDefault) : undefined,
      hook_events: hookEvents,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    },
  });

  return {
    stepRun,
    outputs: stepRun.outputs,
    error: lastError,
    waitingForInput,
  };
}

async function executeParallelStep({
  definition,
  step,
  childSteps,
  state,
  run,
  runsDir,
  effectiveRuntime,
  toolRegistry,
  options,
}) {
  if (step.skip_if && evaluateExpression(step.skip_if, state)) {
    const skippedRun = await finalizeStepRun({
      definition,
      step,
      state,
      effectiveRuntime,
      runId: run.run_id,
      runsDir,
      useHooks: true,
      stepRun: {
        id: step.id,
        kind: step.kind,
        status: "skipped",
        attempts: 0,
        inputs: {},
        outputs: null,
        error: null,
        hook_events: [],
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      },
    });

    run.steps.push(skippedRun);
    return { stepRun: skippedRun, outputs: null, error: null };
  }

  const hookEvents = [];
  const beforeResult = await callHook(effectiveRuntime.hooks?.beforeStep, {
    runId: run.run_id,
    step,
    state,
  }, hookEvents);

  if (beforeResult?.abort) {
    return {
      abortRun: {
        reason: beforeResult.reason ?? `beforeStep aborted step '${step.id}'.`,
      },
    };
  }

  const startedAt = new Date().toISOString();
  let attempts = 0;
  let lastError = null;
  let childResults = [];
  let childStepRuns = [];
  let inputsByStep = {};
  let finalOutputs = null;

  while (attempts <= (step.retry ?? 0)) {
    attempts += 1;

    childResults = await Promise.all(childSteps.map((childStep) => executeStep({
      definition,
      step: childStep,
      state,
      runId: run.run_id,
      runsDir,
      effectiveRuntime,
      toolRegistry,
      options,
      useHooks: false,
    })));

    for (const childResult of childResults) {
      if (childResult.abortRun) {
        return childResult;
      }
    }

    childStepRuns = childResults.map((result) => result.stepRun);

    const failedChildren = childResults.filter((result) => result.error);
    inputsByStep = Object.fromEntries(childStepRuns.map((stepRun) => [stepRun.id, stepRun.inputs]));
    const outputsByStep = Object.fromEntries(childStepRuns.map((stepRun) => [stepRun.id, stepRun.outputs]));
    finalOutputs = {
      results: childStepRuns.map((stepRun) => stepRun.outputs),
      by_step: outputsByStep,
      step_ids: childStepRuns.map((stepRun) => stepRun.id),
    };

    if (failedChildren.length) {
      lastError = new RuntimeError(
        `parallel '${step.id}' failed: ${failedChildren
          .map((result) => `${result.stepRun.id}: ${result.error.message}`)
          .join("; ")}`,
      );
      continue;
    }

    const issues = validateShape(
      finalOutputs,
      step.out ?? DEFAULT_PARALLEL_OUTPUT_SCHEMA,
      `steps.${step.id}`,
    );

    if (issues.length) {
      lastError = new RuntimeError(`parallel output failed validation: ${issues.join("; ")}`);
      continue;
    }

    lastError = null;
    break;
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

  run.steps.push(...childStepRuns);

  const stepRun = await finalizeStepRun({
    definition,
    step,
    state,
    effectiveRuntime,
    runId: run.run_id,
    runsDir,
    useHooks: true,
    stepRun: {
      id: step.id,
      kind: step.kind,
      status: lastError ? "failed" : "success",
      attempts,
      inputs: {
        by_step: deepClone(inputsByStep),
      },
      outputs: lastError ? null : deepClone(finalOutputs),
      error: lastError ? serializeError(lastError) : null,
      input_hash: step.cache !== false ? hashStepInputs(inputsByStep) : undefined,
      hook_events: hookEvents,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    },
  });

  run.steps.push(stepRun);

  return {
    stepRun,
    outputs: stepRun.outputs,
    error: lastError,
  };
}

export async function runSkill(definition, inputs, runtime = {}, options = {}) {
  const resolvedDefinition = {
    ...definition,
    workflow: resolveWorkflowBlocks(definition.workflow ?? { steps: [], output: {} }),
  };
  const toolRegistry = loadToolRegistry(options);
  const validation = validateSkill(resolvedDefinition, options);
  if (!validation.valid) {
    throw new ValidationError("Skill validation failed.", validation.issues);
  }

  const runsDir = options.runsDir ?? path.resolve(process.cwd(), DEFAULT_RUNS_DIR);
  const effectiveRuntime = createRuntime(runtime, options);

  // Auth pre-flight — only check providers not already handled by the runtime
  // Skip entirely if runtime provides its own llms handlers
  if (options.checkAuth !== false && !runtime.llms) {
    const authErrors = checkAuth(resolvedDefinition, options);
    if (authErrors.length) {
      throw new ValidationError("Auth pre-flight failed.", authErrors);
    }
  }
  const run = {
    run_id: createRunId(),
    runeflow: {
      name: resolvedDefinition.metadata.name,
      version: resolvedDefinition.metadata.version,
    },
    status: "running",
    inputs: deepClone(inputs),
    steps: [],
    outputs: {},
    started_at: new Date().toISOString(),
    finished_at: null,
    error: null,
  };

  const stepIndex = new Map(resolvedDefinition.workflow.steps.map((step, index) => [step.id, index]));
  let index = 0;

  while (index < resolvedDefinition.workflow.steps.length) {
    const step = resolvedDefinition.workflow.steps[index];
    const state = buildState(inputs, run.steps, resolvedDefinition.consts ?? {});
    const result = step.kind === "parallel"
      ? await executeParallelStep({
        definition: resolvedDefinition,
        step,
        childSteps: resolvedDefinition.workflow.steps.slice(index + 1, index + 1 + step.steps.length),
        state,
        run,
        runsDir,
        effectiveRuntime,
        toolRegistry,
        options,
      })
      : await executeStep({
        definition: resolvedDefinition,
        step,
        state,
        runId: run.run_id,
        runsDir,
        effectiveRuntime,
        toolRegistry,
        options,
      });

    if (result.abortRun) {
      failRun(run, result.abortRun.reason);
      run.outputs = {};
      run.artifact_path = await writeRunArtifact(run, runsDir);
      return run;
    }

    if (step.kind !== "parallel") {
      run.steps.push(result.stepRun);
    }

    if (result.waitingForInput) {
      run.status = "halted_on_input";
      run.halted_step_id = step.id;
      run.pending_input = {
        step_id: step.id,
        prompt: result.waitingForInput.prompt,
        choices: result.waitingForInput.choices ?? null,
        default: result.waitingForInput.default,
      };
      run.error = null;
      run.finished_at = new Date().toISOString();
      run.outputs = {};
      run.artifact_path = await writeRunArtifact(run, runsDir);
      return run;
    }

    if (result.error) {
      const resolvedFailMessage = step.failMessage ? resolveBindings(step.failMessage, state) : null;
      if (!step.fallback || step.fallback === "fail") {
        haltRun(run, step.id, resolvedFailMessage ?? result.error.message, result.error);
        run.outputs = {};
        run.artifact_path = await writeRunArtifact(run, runsDir);
        return run;
      }

      index = stepIndex.get(step.fallback);
      continue;
    }

    if (step.kind === "branch") {
      if (result.outputs.target === "fail") {
        const resolvedFailMessage = step.failMessage ? resolveBindings(step.failMessage, state) : null;
        failRun(run, resolvedFailMessage ?? `Branch '${step.id}' selected fail target.`);
        run.outputs = {};
        run.artifact_path = await writeRunArtifact(run, runsDir);
        return run;
      }

      index = stepIndex.get(result.outputs.target);
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

    index += step.kind === "parallel" ? step.steps.length + 1 : 1;
  }

  const finalState = buildState(inputs, run.steps, resolvedDefinition.consts ?? {});

  run.outputs = resolveBindings(resolvedDefinition.workflow.output, finalState);
  const outputIssues = validateShape(run.outputs, resolvedDefinition.metadata.outputs, "outputs");
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
