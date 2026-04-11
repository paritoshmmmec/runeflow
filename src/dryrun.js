/**
 * runeflow dryrun
 *
 * Walks a skill definition step-by-step, resolving all bindings and
 * expressions with the provided inputs, but executes nothing. No tool
 * calls, no LLM calls, no shell commands, no artifact writes.
 *
 * The output is a structured plan showing exactly what each step
 * *would* do: resolved tool args, LLM prompts, CLI commands, branch
 * conditions, transform expressions, and human_input prompts.
 *
 * Steps that depend on prior step outputs use placeholder values
 * derived from the output schema (e.g. "<string>" for string fields).
 */

import { resolveWorkflowBlocks } from "./blocks.js";
import { evaluateExpression, resolveBindings } from "./expression.js";
import { validateSkill } from "./validator.js";
import { loadToolRegistry, getToolOutputSchema } from "./tool-registry.js";
import { createRuntimeEnvironment, closeRuntimePlugins } from "./runtime-plugins.js";
import { deepClone } from "./utils.js";

// ─── Schema-based placeholder generation ──────────────────────────────────────

function placeholderFromSchema(schema) {
  if (schema === undefined || schema === null) return "<unknown>";

  if (schema === "string") return "<string>";
  if (schema === "number") return 0;
  if (schema === "boolean") return false;
  if (schema === "any") return "<any>";
  if (schema === "object") return {};

  if (typeof schema !== "object") return "<unknown>";

  if (Array.isArray(schema)) {
    return schema.length === 0 ? [] : [placeholderFromSchema(schema[0])];
  }

  if (schema.type && !schema.properties) {
    if (schema.type === "string") return "<string>";
    if (schema.type === "number" || schema.type === "integer") return 0;
    if (schema.type === "boolean") return false;
    if (schema.type === "array") return schema.items ? [placeholderFromSchema(schema.items)] : [];
    if (schema.type === "object") return {};
    return "<unknown>";
  }

  if (schema.type === "object" && schema.properties) {
    const result = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      result[key] = placeholderFromSchema(value);
    }
    return result;
  }

  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" || key === "required" || key === "additionalProperties") continue;
    result[key] = placeholderFromSchema(value);
  }
  return result;
}

function buildPlaceholderOutputs(step, toolRegistry) {
  const schema = step.schema ?? step.out ?? getToolOutputSchema(step.tool, toolRegistry);
  if (!schema) return {};
  return placeholderFromSchema(schema);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildState(inputs, completedSteps, consts) {
  return {
    inputs,
    stepMap: Object.fromEntries(completedSteps.map((s) => [s.id, s])),
    consts: consts ?? {},
  };
}

function tryResolve(fn) {
  try {
    return { value: fn(), error: null };
  } catch (error) {
    return { value: null, error: error.message };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Dryrun a runeflow definition.
 *
 * @param {object} definition  - parsed runeflow definition
 * @param {object} inputs      - workflow inputs
 * @param {object} runtime     - optional runtime (for tool registry / plugins)
 * @param {object} options     - { toolRegistry }
 * @returns {Promise<object>}  - { valid, validation, steps[], output }
 */
export async function dryrunRuneflow(definition, inputs = {}, runtime = {}, options = {}) {
  const environment = createRuntimeEnvironment(runtime, options);
  const toolRegistry = loadToolRegistry({
    runtimeToolRegistry: environment.toolRegistry,
    toolRegistry: options.toolRegistry,
  });

  try {
    const validation = validateSkill(definition, { toolRegistry });

    if (!validation.valid) {
      return { valid: false, validation, steps: [], output: null };
    }

    const resolvedWorkflow = resolveWorkflowBlocks(definition.workflow ?? { steps: [], output: {} });
  const steps = resolvedWorkflow.steps;
  const stepIndex = new Map(steps.map((s, idx) => [s.id, idx]));
  const completedSteps = [];
  const plan = [];
  const handledByParallel = new Set();
  let i = 0;

  while (i < steps.length) {
    const step = steps[i];

    // Skip steps already handled as children of a parallel block
    if (handledByParallel.has(step.id)) {
      plan.push({ id: step.id, kind: step.kind, status: "handled_by_parallel" });
      i += 1;
      continue;
    }

    // Parallel block — fan out child tool steps
    if (step.kind === "parallel") {
      const childIds = step.steps ?? [];
      const childResults = [];
      for (const childId of childIds) {
        handledByParallel.add(childId);
        const childIdx = stepIndex.get(childId);
        const childStep = childIdx !== undefined ? steps[childIdx] : undefined;
        if (!childStep) continue;
        const state = buildState(inputs, completedSteps, definition.consts);
        const resolvedWith = tryResolve(() => resolveBindings(childStep.with ?? {}, state));
        childResults.push({
          id: childStep.id,
          kind: childStep.kind,
          tool: childStep.tool,
          resolved_with: resolvedWith.value,
          resolve_error: resolvedWith.error,
        });
      }
      const placeholderOutputs = buildPlaceholderOutputs(step, toolRegistry);
      completedSteps.push({ id: step.id, kind: step.kind, status: "success", outputs: placeholderOutputs });
      plan.push({ id: step.id, kind: step.kind, status: "would_execute", children: childResults, placeholder_outputs: placeholderOutputs });
      i += 1;
      continue;
    }

    const state = buildState(inputs, completedSteps, definition.consts);

    // skip_if
    if (step.skip_if) {
      const skipResult = tryResolve(() => evaluateExpression(step.skip_if, state));
      if (skipResult.value) {
        plan.push({ id: step.id, kind: step.kind, status: "skipped", reason: `skip_if evaluated to true: ${step.skip_if}` });
        completedSteps.push({ id: step.id, kind: step.kind, status: "skipped", outputs: {} });
        i += 1;
        continue;
      }
    }

    if (step.kind === "fail") {
      const resolvedMessage = tryResolve(() => resolveBindings(step.message, state));
      plan.push({ id: step.id, kind: "fail", status: "would_halt", resolved_message: resolvedMessage.value, resolve_error: resolvedMessage.error });
      break;
    }

    if (step.kind === "tool") {
      const resolvedWith = tryResolve(() => resolveBindings(step.with ?? {}, state));
      const placeholderOutputs = buildPlaceholderOutputs(step, toolRegistry);
      plan.push({
        id: step.id, kind: step.kind, tool: step.tool, status: "would_execute",
        resolved_with: resolvedWith.value, resolve_error: resolvedWith.error,
        placeholder_outputs: placeholderOutputs,
        ...(step.retry ? { retry: step.retry } : {}),
        ...(step.fallback ? { fallback: step.fallback } : {}),
        ...(step.cache === false ? { cache: false } : {}),
      });
      completedSteps.push({ id: step.id, kind: step.kind, status: "success", outputs: placeholderOutputs });

    } else if (step.kind === "llm") {
      const resolvedPrompt = tryResolve(() => resolveBindings(step.prompt, state));
      const resolvedInput = tryResolve(() => resolveBindings(step.input ?? {}, state));
      const placeholderOutputs = buildPlaceholderOutputs(step, toolRegistry);
      plan.push({
        id: step.id, kind: step.kind, status: "would_execute",
        resolved_prompt: resolvedPrompt.value, resolved_input: resolvedInput.value,
        resolve_error: resolvedPrompt.error || resolvedInput.error || null,
        schema: deepClone(step.schema), placeholder_outputs: placeholderOutputs,
        ...(step.retry ? { retry: step.retry } : {}),
        ...(step.fallback ? { fallback: step.fallback } : {}),
        ...(step.docs ? { docs: step.docs } : {}),
      });
      completedSteps.push({ id: step.id, kind: step.kind, status: "success", outputs: placeholderOutputs });

    } else if (step.kind === "branch") {
      const condResult = tryResolve(() => evaluateExpression(step.if, state));
      const target = condResult.error ? null : (condResult.value ? step.then : step.else);
      plan.push({
        id: step.id, kind: step.kind, status: "would_branch",
        condition: step.if, resolved_condition: condResult.value,
        resolve_error: condResult.error, target, then: step.then, else: step.else,
      });
      completedSteps.push({ id: step.id, kind: step.kind, status: "success", outputs: { matched: Boolean(condResult.value), target } });

      if (target && stepIndex.has(target)) {
        i = stepIndex.get(target);
        continue;
      }
      break;

    } else if (step.kind === "transform") {
      const resolvedInput = tryResolve(() => resolveBindings(step.input, state));
      const placeholderOutputs = buildPlaceholderOutputs(step, toolRegistry);
      plan.push({
        id: step.id, kind: step.kind, status: "would_execute",
        resolved_input: resolvedInput.value, resolve_error: resolvedInput.error,
        expr: step.expr, placeholder_outputs: placeholderOutputs,
      });
      let outputs = placeholderOutputs;
      if (resolvedInput.value !== null && !resolvedInput.error) {
        try {
          // eslint-disable-next-line no-new-func
          outputs = new Function("input", `return (${step.expr})`)(resolvedInput.value);
          plan[plan.length - 1].computed_outputs = deepClone(outputs);
        } catch {
          // fall back to placeholder
        }
      }
      completedSteps.push({ id: step.id, kind: step.kind, status: "success", outputs: deepClone(outputs) });

    } else if (step.kind === "cli") {
      const resolvedCommand = tryResolve(() => resolveBindings(step.command, state));
      plan.push({
        id: step.id, kind: step.kind, status: "would_execute",
        resolved_command: resolvedCommand.value, resolve_error: resolvedCommand.error,
        ...(step.allow_failure ? { allow_failure: true } : {}),
        ...(step.cache === false ? { cache: false } : {}),
      });
      completedSteps.push({ id: step.id, kind: step.kind, status: "success", outputs: { stdout: "<stdout>", stderr: "<stderr>", exit_code: 0 } });

    } else if (step.kind === "human_input") {
      const resolvedPrompt = tryResolve(() => resolveBindings(step.prompt, state));
      const resolvedChoices = step.choices ? tryResolve(() => resolveBindings(step.choices, state)) : null;
      const resolvedDefault = step.default !== undefined ? tryResolve(() => resolveBindings(step.default, state)) : null;
      plan.push({
        id: step.id, kind: step.kind, status: "would_halt",
        resolved_prompt: resolvedPrompt.value, resolve_error: resolvedPrompt.error,
        ...(resolvedChoices ? { resolved_choices: resolvedChoices.value } : {}),
        ...(resolvedDefault ? { resolved_default: resolvedDefault.value } : {}),
      });
      completedSteps.push({ id: step.id, kind: step.kind, status: "success", outputs: { answer: resolvedDefault?.value ?? "<pending>" } });
    }

    // next → jump
    if (step.next && step.next !== "fail" && stepIndex.has(step.next)) {
      i = stepIndex.get(step.next);
      continue;
    } else if (step.next === "fail") {
      plan.push({ id: `${step.id}:next`, kind: "fail", status: "would_halt" });
      break;
    }

    i += 1;
  }

  const finalState = buildState(inputs, completedSteps, definition.consts);
  const outputDef = resolvedWorkflow.output;
  const resolvedOutput = outputDef ? tryResolve(() => resolveBindings(outputDef, finalState)) : null;

  return {
    valid: true,
    validation,
    steps: plan,
    output: resolvedOutput?.value ?? null,
    output_resolve_error: resolvedOutput?.error ?? null,
  };
  } finally {
    await closeRuntimePlugins(environment).catch(() => {});
  }
}

export const dryrunSkill = dryrunRuneflow;
