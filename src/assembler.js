/**
 * runeflow assemble
 *
 * Runs all tool/transform steps before a target llm step, resolves the prompt
 * and input with real values, then renders a clean Markdown context file.
 *
 * The output is designed to be loaded by an agent (Claude Code, Codex, Cursor)
 * instead of the raw skill file. The agent sees only what it needs for one step:
 * the relevant docs, the resolved prompt, the resolved input, and the output schema.
 *
 * Zero changes to runtime.js — this is purely additive.
 */
import { RuntimeError } from "./errors.js";
import { evaluateExpression, hasTemplateExpressions, looksLikeExpression, resolveTemplate } from "./expression.js";
import { closeRuntimePlugins, createRuntimeEnvironment } from "./runtime-plugins.js";
import { isPlainObject, deepClone } from "./utils.js";

// ─── Binding resolution (mirrors runtime.js, no artifact writing) ─────────────

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

function buildStepState(completedSteps) {
  return Object.fromEntries(completedSteps.map((s) => [s.id, s]));
}

// ─── Pre-step executor (tool + transform only, no LLM, no artifacts) ─────────

async function executePreSteps(definition, targetStepId, inputs, tools) {
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

  for (let i = 0; i < targetIndex; i++) {
    const step = steps[i];
    const state = {
      inputs,
      stepMap: buildStepState(completedSteps),
      consts: definition.consts ?? {},
    };

    if (step.kind === "tool") {
      const tool = tools[step.tool];
      if (!tool) {
        throw new RuntimeError(
          `Tool '${step.tool}' is not registered. Pass --runtime to provide custom tools.`,
        );
      }
      const resolvedInput = resolveBindings(step.with ?? {}, state);
      const outputs = await tool(resolvedInput, { step, state });
      completedSteps.push({ id: step.id, kind: step.kind, outputs: deepClone(outputs) });

    } else if (step.kind === "transform") {
      const resolvedInput = resolveBindings(step.input, state);
      // eslint-disable-next-line no-new-func
      const outputs = new Function("input", `return (${step.expr})`)(resolvedInput);
      completedSteps.push({ id: step.id, kind: step.kind, outputs: deepClone(outputs) });

    } else if (step.kind === "branch") {
      // Evaluate the branch and follow the chosen path — skip the other branch's steps
      const matched = evaluateExpression(step.if, state);
      const target = matched ? step.then : step.else;
      completedSteps.push({
        id: step.id,
        kind: step.kind,
        outputs: { matched, target },
      });
      // If the branch routes away from the target step, we can't assemble
      // Check if target step is still reachable
      const targetReachable = isStepReachable(steps, target, targetStepId);
      if (!targetReachable) {
        throw new RuntimeError(
          `Branch '${step.id}' routes to '${target}', which does not reach step '${targetStepId}'. ` +
          `The target step is not reachable with the given inputs.`,
        );
      }

    } else if (step.kind === "llm") {
      throw new RuntimeError(
        `Cannot assemble step '${targetStepId}': step '${step.id}' is an llm step that must execute first. ` +
        `assemble only works when all preceding steps are tool, transform, or branch.`,
      );
    }
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

function renderAssembled({ definition, targetStep, resolvedPrompt, resolvedInput, docs }) {
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
 * Runs all tool/transform steps before the target, resolves the prompt and
 * input with real values, and returns a Markdown string ready for an agent.
 *
 * @param {object} definition  - parsed runeflow definition
 * @param {string} stepId      - id of the target llm step
 * @param {object} inputs      - workflow inputs
 * @param {object} runtime     - optional runtime with custom tools
 * @param {object} options     - { cwd }
 * @returns {Promise<string>}  - assembled Markdown
 */
export async function assembleRuneflow(definition, stepId, inputs = {}, runtime = {}, options = {}) {
  const environment = createRuntimeEnvironment(runtime, options);

  try {
    const completedSteps = await executePreSteps(definition, stepId, inputs, environment.tools);

    const steps = definition.workflow.steps;
    const targetStep = steps.find((s) => s.id === stepId);

    const state = {
      inputs,
      stepMap: buildStepState(completedSteps),
      consts: definition.consts ?? {},
    };

    const resolvedPrompt = resolveBindings(targetStep.prompt, state);
    const resolvedInput = resolveBindings(targetStep.input ?? {}, state);

    const docs = targetStep.docs
      ? (definition.docBlocks?.[targetStep.docs] ?? definition.docs)
      : definition.docs;

    return renderAssembled({
      definition,
      targetStep,
      resolvedPrompt,
      resolvedInput,
      docs,
    });
  } finally {
    await closeRuntimePlugins(environment).catch(() => {});
  }
}

export const assembleSkill = assembleRuneflow;
