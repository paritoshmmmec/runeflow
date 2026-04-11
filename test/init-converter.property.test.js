// Feature: smarter-init, Property 4: Converted skill always passes validation
// Feature: smarter-init, Property 5: Tool definitions map to tool steps

import test from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import { convertClaudeSkill } from "../src/init-converter.js";
import { parseRuneflow } from "../src/parser.js";
import { validateRuneflow } from "../src/validator.js";

// ---------------------------------------------------------------------------
// Property 4: Converted skill always passes validation
// ---------------------------------------------------------------------------

/**
 * Build a synthetic Claude-style Markdown string from random flags.
 */
function buildSyntheticSkill({ hasSystem, hasInstructions, toolCount, hasIoAnnotations, hasToolUse }) {
  const parts = ["# Synthetic Skill\n"];

  if (hasSystem) {
    parts.push("<system>\nYou are a helpful assistant. Complete the task carefully.\n</system>\n");
  }

  if (hasInstructions && !hasSystem) {
    // Use instructions only when system is absent to avoid duplicate LLM steps
    parts.push("<instructions>\nFollow the instructions precisely.\n</instructions>\n");
  }

  if (hasIoAnnotations) {
    parts.push("Input: query: string\nOutput: result: string\n");
  }

  if (toolCount > 0) {
    const toolLines = Array.from({ length: toolCount }, (_, i) => `- tool_${i + 1}: Description of tool ${i + 1}`);
    parts.push(`## Tools\n\n${toolLines.join("\n")}\n`);
  }

  if (hasToolUse) {
    parts.push('<tool_use>\n{"name": "file.read", "input": {"path": "README.md"}}\n</tool_use>\n');
  }

  return parts.join("\n");
}

/**
 * Validates: Requirements 1b.4, 1b.7
 */
test("Property 4: Converted skill always passes validation for any combination of Claude constructs", () => {
  fc.assert(
    fc.property(
      fc.record({
        hasSystem: fc.boolean(),
        hasInstructions: fc.boolean(),
        toolCount: fc.integer({ min: 0, max: 5 }),
        hasIoAnnotations: fc.boolean(),
        hasToolUse: fc.boolean(),
      }),
      (flags) => {
        const source = buildSyntheticSkill(flags);
        const result = convertClaudeSkill(source, { sourcePath: "synthetic.md" });

        assert.equal(result.valid, true, `convertClaudeSkill returned valid=false for flags: ${JSON.stringify(flags)}`);

        const parsed = parseRuneflow(result.output);
        const validation = validateRuneflow(parsed);

        assert.equal(
          validation.valid,
          true,
          `validateRuneflow failed for flags ${JSON.stringify(flags)}. Issues: ${JSON.stringify(validation.issues)}`,
        );

        assert.equal(
          validation.issues.length,
          0,
          `Expected zero issues but got: ${JSON.stringify(validation.issues)}`,
        );
      },
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 5: Tool definitions map to tool steps
// ---------------------------------------------------------------------------

/**
 * Count occurrences of `type=tool` in the runeflow block of the output.
 * We count step declarations of the form `step <id> type=tool`.
 */
function countToolSteps(output) {
  const matches = output.match(/\bstep\s+\S+\s+type=tool\b/g);
  return matches ? matches.length : 0;
}

/**
 * Validates: Requirements 1b.5
 */
test("Property 5: Tool definitions map to tool steps — N tools in ## Tools section produces exactly N tool steps", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 8 }),
      (n) => {
        const toolLines = Array.from({ length: n }, (_, i) => `- tool_${i + 1}: Description of tool ${i + 1}`);
        const source = `# Tool Skill\n\n## Tools\n\n${toolLines.join("\n")}\n`;

        const result = convertClaudeSkill(source, { sourcePath: "tools-only.md" });

        const toolStepCount = countToolSteps(result.output);

        assert.equal(
          toolStepCount,
          n,
          `Expected ${n} tool steps but found ${toolStepCount} for N=${n}. Output:\n${result.output}`,
        );
      },
    ),
    { numRuns: 100 },
  );
});
