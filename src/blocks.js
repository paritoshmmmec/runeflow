import { SkillSyntaxError } from "./errors.js";

const BLOCK_TEMPLATE_KINDS = new Set(["tool", "llm", "transform"]);

/**
 * Expands `step … type=block { block: name, … }` using named `block` declarations.
 * Drops `workflow.blocks` from the returned workflow.
 */
export function resolveWorkflowBlocks(workflow, importedBlocks = new Map()) {
  if (!workflow || typeof workflow !== "object") {
    return workflow;
  }

  const blockList = workflow.blocks ?? [];
  const steps = workflow.steps ?? [];
  const hasBlockSteps = steps.some((s) => s.kind === "block");

  if (blockList.length === 0 && !hasBlockSteps && importedBlocks.size === 0) {
    return { steps, output: workflow.output ?? {} };
  }

  const seen = new Set(importedBlocks.keys());
  for (const b of blockList) {
    if (seen.has(b.id)) {
      throw new SkillSyntaxError(`Duplicate block id '${b.id}'.`);
    }
    seen.add(b.id);

    if (b.kind === "branch") {
      throw new SkillSyntaxError(`Block '${b.id}' cannot use kind 'branch'.`);
    }

    if (!BLOCK_TEMPLATE_KINDS.has(b.kind)) {
      throw new SkillSyntaxError(
        `Block '${b.id}' must use kind tool, llm, or transform (got '${b.kind ?? ""}').`,
      );
    }
  }

  const blockMap = new Map([
    ...importedBlocks.entries(),
    ...blockList.map((b) => [b.id, b])
  ]);

  const resolvedSteps = steps.map((step) => {
    if (step.kind !== "block") {
      return step;
    }

    const ref = step.block;
    if (typeof ref !== "string" || !ref.trim()) {
      throw new SkillSyntaxError(`Step '${step.id}' type=block must declare a 'block' reference.`);
    }

    const template = blockMap.get(ref);
    if (!template) {
      throw new SkillSyntaxError(`Unknown block '${ref}' referenced by step '${step.id}'.`);
    }

    const { block: _br, kind: _sk, id: _sid, ...stepOverrides } = step;
    const { id: _bid, ...templateFields } = template;

    return {
      ...templateFields,
      ...stepOverrides,
      id: step.id,
      kind: template.kind,
    };
  });

  return {
    steps: resolvedSteps,
    output: workflow.output ?? {},
    blocks: blockList,  // preserve for cross-file import consumers
  };
}
