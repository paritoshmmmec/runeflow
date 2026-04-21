/**
 * runeflow assemble
 *
 * Runs all tool/transform/llm/cli/branch steps before a target llm step,
 * resolves the prompt and input with real values, then renders a clean
 * Markdown context file.
 *
 * The output is designed to be loaded by an agent (Claude Code, Codex, Cursor)
 * instead of the raw .md. The agent sees only what it needs for one step:
 * the relevant docs, the resolved prompt, the resolved input, and the output schema.
 *
 * Zero changes to runtime.js — this is purely additive.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RuntimeError } from "./errors.js";
import { evaluateExpression, resolveBindings, resolveShellBindings } from "./expression.js";
import { closeRuntimePlugins, createRuntimeEnvironment } from "./runtime-plugins.js";
import { deepClone, evalTransformExpr } from "./utils.js";

const execFileAsync = promisify(execFile);

function buildStepState(completedSteps, inputs, consts) {
  return {
    inputs,
    stepMap: Object.fromEntries(completedSteps.map((s) => [s.id, s])),
    consts: consts ?? {},
  };
}

function summarizeAssembledStep(stepRun) {
  const summary = {
    id: stepRun.id,
    kind: stepRun.kind,
    status: stepRun.status,
  };

  if (stepRun.kind === "parallel" && Array.isArray(stepRun.child_ids)) {
    summary.child_ids = [...stepRun.child_ids];
  }

  if (stepRun.kind === "branch") {
    summary.matched = stepRun.outputs?.matched ?? false;
    summary.target = stepRun.outputs?.target ?? null;
  }

  if (stepRun.kind === "human_input" && stepRun.input_source) {
    summary.input_source = stepRun.input_source;
  }

  if (stepRun.kind === "llm" && stepRun.provider) {
    summary.provider = stepRun.provider;
  }

  return summary;
}

function buildAssemblyMetadata(completedSteps) {
  const preSteps = completedSteps.map(summarizeAssembledStep);
  const llmPreSteps = preSteps.filter((step) => step.kind === "llm");
  const placeholderInputs = preSteps.filter(
    (step) => step.kind === "human_input" && step.input_source === "placeholder",
  );
  const defaultInputs = preSteps.filter(
    (step) => step.kind === "human_input" && step.input_source === "default",
  );
  const notes = [];

  if (llmPreSteps.length > 0) {
    notes.push(
      `${llmPreSteps.length} earlier llm step${llmPreSteps.length === 1 ? "" : "s"} `
      + `ran during assembly and may have consumed tokens.`,
    );
  }

  if (defaultInputs.length > 0) {
    notes.push(
      `${defaultInputs.length} human_input step${defaultInputs.length === 1 ? "" : "s"} `
      + `used the configured default value during assembly.`,
    );
  }

  if (placeholderInputs.length > 0) {
    notes.push(
      `${placeholderInputs.length} human_input step${placeholderInputs.length === 1 ? "" : "s"} `
      + `had no default, so assembly inserted "<pending>".`,
    );
  }

  return {
    pre_steps: preSteps,
    stats: {
      total_pre_steps: preSteps.length,
      llm_pre_steps: llmPreSteps.length,
      human_input_defaults: defaultInputs.length,
      human_input_placeholders: placeholderInputs.length,
    },
    notes,
  };
}

async function executeAssembledStep(step, state, definition, environment, options) {
  if (step.skip_if && evaluateExpression(step.skip_if, state)) {
    return { id: step.id, kind: step.kind, status: "skipped", outputs: {} };
  }

  const { tools, llms } = environment;

  if (step.kind === "tool") {
    const tool = tools[step.tool];
    if (!tool) {
      throw new RuntimeError(
        `Tool '${step.tool}' is not registered. Pass --runtime to provide custom tools.`,
      );
    }
    const resolvedInput = resolveBindings(step.with ?? {}, state);
    const outputs = await tool(resolvedInput, { step, state });
    return { id: step.id, kind: step.kind, status: "success", outputs: deepClone(outputs) };
  }

  if (step.kind === "llm") {
    const llmConfig = step.llm ?? definition.metadata.llm ?? null;
    const provider = llmConfig?.provider ?? "_auto";
    const handler = llms?.[provider];
    if (typeof handler !== "function") {
      throw new RuntimeError(
        llmConfig?.provider
          ? `No LLM handler registered for provider '${llmConfig.provider}'. Pass --runtime to provide custom LLM handlers.`
          : `Step '${step.id}' relies on LLM auto-selection and this runtime has no '_auto' handler. Declare \`llm.provider\` explicitly or use the default runtime.`,
      );
    }
    const resolvedPrompt = resolveBindings(step.prompt, state);
    const resolvedInput = resolveBindings(step.input ?? {}, state);
    const docs = step.docs
      ? (definition.docBlocks?.[step.docs] ?? definition.docs)
      : definition.docs;
    const outputs = await handler({
      step,
      llm: deepClone(llmConfig),
      prompt: resolvedPrompt,
      input: resolvedInput,
      schema: step.schema,
      state,
      docs,
      context: { docs, metadata: deepClone(definition.metadata), source_path: definition.sourcePath ?? null },
    });
    return {
      id: step.id,
      kind: step.kind,
      status: "success",
      outputs: deepClone(outputs),
      provider,
    };
  }

  if (step.kind === "transform") {
    const resolvedInput = resolveBindings(step.input, state);
    const outputs = evalTransformExpr(step.expr, resolvedInput);
    return { id: step.id, kind: step.kind, status: "success", outputs: deepClone(outputs) };
  }

  if (step.kind === "cli") {
    const resolvedCommand = resolveShellBindings(step.command, state);
    if (typeof resolvedCommand !== "string" || !resolvedCommand.trim()) {
      throw new RuntimeError(`cli step '${step.id}' command resolved to an empty string.`);
    }
    const cwd = options?.cwd ?? process.cwd();
    const timeout = step.timeout ?? 30_000;
    let outputs;
    try {
      const { stdout, stderr } = await execFileAsync(
        process.platform === "win32" ? "cmd" : "sh",
        process.platform === "win32" ? ["/c", resolvedCommand] : ["-c", resolvedCommand],
        { cwd, timeout, maxBuffer: 10 * 1024 * 1024 },
      );
      outputs = { stdout: stdout ?? "", stderr: stderr ?? "", exit_code: 0 };
    } catch (error) {
      if (typeof error.code === "number") {
        outputs = { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exit_code: error.code };
        if (step.allow_failure !== true) {
          throw new RuntimeError(
            `cli step '${step.id}' exited with code ${error.code}.\nstderr: ${error.stderr || "(empty)"}`,
          );
        }
      } else {
        throw new RuntimeError(`cli step '${step.id}' failed to execute: ${error.message}`);
      }
    }
    return { id: step.id, kind: step.kind, status: "success", outputs };
  }

  if (step.kind === "branch") {
    const matched = evaluateExpression(step.if, state);
    const target = matched ? step.then : step.else;
    return { id: step.id, kind: step.kind, status: "success", outputs: { matched, target } };
  }

  if (step.kind === "human_input") {
    const hasDefault = step.default !== undefined;
    const resolvedDefault = hasDefault
      ? resolveBindings(step.default, state)
      : "<pending>";
    return {
      id: step.id,
      kind: step.kind,
      status: "success",
      outputs: { answer: resolvedDefault },
      input_source: hasDefault ? "default" : "placeholder",
    };
  }

  if (step.kind === "fail") {
    const resolvedMessage = step.message ? resolveBindings(step.message, state) : "Explicit fail step hit.";
    throw new RuntimeError(resolvedMessage);
  }

  throw new RuntimeError(`Unsupported step kind '${step.kind}'.`);
}

// ─── Pre-step executor ────────────────────────────────────────────────────────

async function executePreSteps(definition, targetStepId, inputs, environment, options) {
  const steps = definition.workflow.steps;
  const targetIndex = steps.findIndex((s) => s.id === targetStepId);

  if (targetIndex === -1) {
    throw new RuntimeError(`Step '${targetStepId}' not found in skill '${definition.metadata.name}'.`);
  }

  const targetStep = steps[targetIndex];
  if (targetStep.kind !== "llm") {
    throw new RuntimeError(`assemble only works on 'llm' steps. Step '${targetStepId}' is kind '${targetStep.kind}'.`);
  }

  const completedSteps = [];
  const stepIndex = new Map(steps.map((s, i) => [s.id, i]));
  let i = 0;

  while (i < targetIndex) {
    const step = steps[i];
    const state = buildStepState(completedSteps, inputs, definition.consts);

    if (step.kind === "branch") {
      const branchResult = await executeAssembledStep(step, state, definition, environment, options);
      completedSteps.push(branchResult);
      const target = branchResult.outputs.target;

      if (target === "fail") {
        throw new RuntimeError(`Branch '${step.id}' routed to fail before reaching step '${targetStepId}'.`);
      }

      const targetReachable = isStepReachable(steps, target, targetStepId);
      if (!targetReachable) {
        throw new RuntimeError(
          `Branch '${step.id}' routes to '${target}', which does not reach step '${targetStepId}'. ` +
          `The target step is not reachable with the given inputs.`,
        );
      }

      // Jump to the branch target
      i = stepIndex.get(target);
      continue;

    } else if (step.kind === "parallel") {
      const childIds = step.steps ?? [];
      const childState = buildStepState(completedSteps, inputs, definition.consts);
      const childResults = await Promise.all(childIds.map(async (childId) => {
        const childIdx = stepIndex.get(childId);
        if (childIdx === undefined) return null;
        const childStep = steps[childIdx];
        return executeAssembledStep(childStep, childState, definition, environment, options);
      }));

      for (const result of childResults) {
        if (result) completedSteps.push(result);
      }

      const realizedChildren = childResults.filter(Boolean);
      completedSteps.push({
        id: step.id,
        kind: step.kind,
        status: "success",
        child_ids: realizedChildren.map((result) => result.id),
        outputs: {
          results: realizedChildren.map((result) => result.outputs),
          by_step: Object.fromEntries(realizedChildren.map((result) => [result.id, result.outputs])),
          step_ids: realizedChildren.map((result) => result.id),
        },
      });

      i += childIds.length + 1;
      continue;
    }

    completedSteps.push(await executeAssembledStep(step, state, definition, environment, options));
    i += 1;
  }

  return completedSteps;
}

function isStepReachable(steps, fromId, targetId) {
  // Simple linear check — walk from fromId to see if targetId appears
  const fromIndex = steps.findIndex((s) => s.id === fromId);
  const targetIndex = steps.findIndex((s) => s.id === targetId);
  return fromIndex !== -1 && fromIndex <= targetIndex;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function schemaToMarkdown(schema) {
  if (!schema) return "_No output schema defined._";
  return "```json\n" + JSON.stringify(schema, null, 2) + "\n```";
}

function renderAssembled({ definition, targetStep, resolvedPrompt, resolvedInput, docs, assembly }) {
  const skillName = definition.metadata.name ?? "skill";
  const lines = [];

  // Header
  lines.push(`# ${skillName} — assembled context for \`${targetStep.id}\``);
  lines.push("");
  lines.push(
    `> Generated by \`runeflow assemble\`. ` +
    `This file contains only what the \`${targetStep.id}\` step needs. ` +
    `Do not modify the output schema section.`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // Operator docs
  if (docs?.trim()) {
    lines.push("## Guidance");
    lines.push("");
    lines.push(docs.trim());
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  if (assembly.notes.length > 0) {
    lines.push("## Assembly notes");
    lines.push("");
    for (const note of assembly.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Resolved prompt
  lines.push("## Your task");
  lines.push("");
  if (typeof resolvedPrompt === "string") {
    lines.push(resolvedPrompt.trim());
  } else {
    lines.push(JSON.stringify(resolvedPrompt, null, 2));
  }
  lines.push("");

  // Resolved input (only if non-empty)
  if (resolvedInput && Object.keys(resolvedInput).length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Resolved input");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(resolvedInput, null, 2));
    lines.push("```");
    lines.push("");
  }

  // Output schema
  lines.push("---");
  lines.push("");
  lines.push("## Output schema");
  lines.push("");
  lines.push("Respond with a JSON object matching this schema exactly.");
  lines.push("Output only the JSON — no markdown fences, no explanation.");
  lines.push("");
  lines.push(schemaToMarkdown(targetStep.schema));
  lines.push("");

  return lines.join("\n");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Assemble a context file for a specific llm step.
 *
 * Runs all steps before the target (tool, llm, cli, transform, branch),
 * resolves the prompt and input with real values, and returns either a
 * Markdown string (default) or a structured JSON object (format: "json").
 *
 * @param {object} definition  - parsed runeflow definition
 * @param {string} stepId      - id of the target llm step
 * @param {object} inputs      - workflow inputs
 * @param {object} runtime     - optional runtime with custom tools and llms
 * @param {object} options     - { cwd, format: "markdown"|"json" }
 * @returns {Promise<string|object>}
 */
export async function assembleRuneflow(definition, stepId, inputs = {}, runtime = {}, options = {}) {
  const environment = createRuntimeEnvironment(runtime, options);

  try {
    const completedSteps = await executePreSteps(definition, stepId, inputs, environment, options);

    const steps = definition.workflow.steps;
    const targetStep = steps.find((s) => s.id === stepId);

    const state = buildStepState(completedSteps, inputs, definition.consts);

    const resolvedPrompt = resolveBindings(targetStep.prompt, state);
    const resolvedInput = resolveBindings(targetStep.input ?? {}, state);

    const docs = targetStep.docs
      ? (definition.docBlocks?.[targetStep.docs] ?? definition.docs)
      : definition.docs;
    const assembly = buildAssemblyMetadata(completedSteps);

    if (options.format === "json") {
      return {
        skill: definition.metadata.name ?? "skill",
        step: targetStep.id,
        docs: docs?.trim() ?? null,
        prompt: typeof resolvedPrompt === "string" ? resolvedPrompt.trim() : resolvedPrompt,
        input: resolvedInput,
        schema: targetStep.schema ?? null,
        pre_steps: assembly.pre_steps,
        execution: assembly.stats,
        notes: assembly.notes,
      };
    }

    return renderAssembled({
      definition,
      targetStep,
      resolvedPrompt,
      resolvedInput,
      docs,
      assembly,
    });
  } finally {
    await closeRuntimePlugins(environment).catch(() => {});
  }
}

export const assembleSkill = assembleRuneflow;
