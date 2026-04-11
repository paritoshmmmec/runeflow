import test from "node:test";
import assert from "node:assert/strict";
import { convertClaudeSkill } from "../src/init-converter.js";
import { parseRuneflow } from "../src/parser.js";
import { validateRuneflow } from "../src/validator.js";

// ---------------------------------------------------------------------------
// 1. Extracts skill name from first # Heading
// ---------------------------------------------------------------------------

test("extracts skill name from first # heading", () => {
  const source = "# My Skill\n\n<system>Do stuff</system>";
  const result = convertClaudeSkill(source, { sourcePath: "whatever.md" });

  assert.equal(result.skillName, "My Skill");
  assert.match(result.output, /name: my-skill/);
});

// ---------------------------------------------------------------------------
// 2. Falls back to filename stem when no heading
// ---------------------------------------------------------------------------

test("falls back to filename stem when no heading present", () => {
  const source = "<system>Do stuff</system>";
  const result = convertClaudeSkill(source, { sourcePath: "my-automation.md" });

  assert.match(result.output, /name: my-automation/);
});

// ---------------------------------------------------------------------------
// 3. Maps <system> block to LLM step prompt
// ---------------------------------------------------------------------------

test("maps <system> block to an LLM step with the system content as prompt", () => {
  const source = "# Assistant\n\n<system>You are a helpful assistant.</system>";
  const result = convertClaudeSkill(source, { sourcePath: "assistant.md" });

  assert.match(result.output, /type=llm/);
  assert.match(result.output, /prompt:/);
  assert.match(result.output, /You are a helpful assistant\./);
});

// ---------------------------------------------------------------------------
// 4. Maps <instructions> block to LLM step prompt (when no <system>)
// ---------------------------------------------------------------------------

test("maps <instructions> block to an LLM step when no <system> is present", () => {
  const source = "# Steps\n\n<instructions>Follow these steps.</instructions>";
  const result = convertClaudeSkill(source, { sourcePath: "steps.md" });

  assert.match(result.output, /type=llm/);
  assert.match(result.output, /Follow these steps\./);
});

// ---------------------------------------------------------------------------
// 5. Maps ## Tools entries to tool steps
// ---------------------------------------------------------------------------

test("maps ## Tools entries to tool steps", () => {
  const source = "# Tools Skill\n\n## Tools\n\n- file.read: Read a file\n- search: Search the web\n";
  const result = convertClaudeSkill(source, { sourcePath: "tools.md" });

  const toolStepMatches = result.output.match(/\bstep\s+\S+\s+type=tool\b/g) ?? [];
  assert.equal(toolStepMatches.length, 2, `Expected 2 tool steps, got ${toolStepMatches.length}`);

  // file.read is a built-in — its step block should use file.read, not replace.me
  const fileReadStepMatch = result.output.match(/step\s+\S+\s+type=tool\s*\{[^}]*tool:\s*file\.read[^}]*\}/s);
  assert.ok(fileReadStepMatch, "Expected a tool step with tool: file.read");
  assert.doesNotMatch(fileReadStepMatch[0], /replace\.me/, "file.read step should not use replace.me placeholder");

  // search is not a built-in — should get a placeholder
  assert.match(result.output, /replace\.me/);
});

// ---------------------------------------------------------------------------
// 6. Maps Input: / Output: annotations to frontmatter
// ---------------------------------------------------------------------------

test("maps Input: / Output: annotations to frontmatter inputs and outputs", () => {
  const source = [
    "# IO Skill",
    "",
    "Input: query: string",
    "Output: result: string",
    "",
    "<system>Do the thing.</system>",
  ].join("\n");

  const result = convertClaudeSkill(source, { sourcePath: "io.md" });
  const parsed = parseRuneflow(result.output);

  assert.ok(
    Object.prototype.hasOwnProperty.call(parsed.metadata.inputs, "query"),
    "inputs should contain 'query'",
  );
  assert.equal(parsed.metadata.inputs.query, "string");

  assert.ok(
    Object.prototype.hasOwnProperty.call(parsed.metadata.outputs, "result"),
    "outputs should contain 'result'",
  );
  assert.equal(parsed.metadata.outputs.result, "string");
});

// ---------------------------------------------------------------------------
// 7. Maps <tool_use> blocks to tool steps
// ---------------------------------------------------------------------------

test("maps <tool_use> blocks to tool steps", () => {
  const source = [
    "# Tool Use Skill",
    "",
    "<tool_use>",
    '{"name": "file.read", "input": {"path": "README.md"}}',
    "</tool_use>",
  ].join("\n");

  const result = convertClaudeSkill(source, { sourcePath: "tool-use.md" });

  assert.match(result.output, /type=tool/);
  assert.match(result.output, /file\.read/);
});

// ---------------------------------------------------------------------------
// 8. Preserves unmappable sections as HTML comments
// ---------------------------------------------------------------------------

test("preserves unmappable content as HTML comment in fallback skeleton", () => {
  const source = "## Notes\n\nThis is just a random note with no mappable content.\n";
  const result = convertClaudeSkill(source, { sourcePath: "notes.md" });

  assert.equal(result.valid, true);

  if (result.warnings.some((w) => w.includes("falling back"))) {
    assert.match(result.output, /<!--/);
    assert.match(result.output, /random note/);
  }
});

// ---------------------------------------------------------------------------
// 9. Empty source always produces a valid result
// ---------------------------------------------------------------------------

test("completely empty source produces a valid result", () => {
  const result = convertClaudeSkill("", { sourcePath: "empty.md" });

  assert.equal(result.valid, true);

  const parsed = parseRuneflow(result.output);
  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, true, `Validation issues: ${JSON.stringify(validation.issues)}`);
});

test("source with only a ## Tools section using a built-in tool produces a valid result", () => {
  const source = "## Tools\n\n- file.read: Read a file\n";
  const result = convertClaudeSkill(source, { sourcePath: "tools-only.md" });

  assert.equal(result.valid, true);

  const parsed = parseRuneflow(result.output);
  const validation = validateRuneflow(parsed);
  assert.equal(validation.valid, true, `Validation issues: ${JSON.stringify(validation.issues)}`);
});

// ---------------------------------------------------------------------------
// 10. Warnings are emitted for unmappable tool names
// ---------------------------------------------------------------------------

test("emits a warning for tool names that cannot be matched to a built-in", () => {
  const source = "# Custom Tool\n\n## Tools\n\n- my_custom_tool: Does something\n";
  const result = convertClaudeSkill(source, { sourcePath: "custom.md" });

  const hasToolWarning = result.warnings.some((w) => w.includes("my_custom_tool"));
  assert.ok(hasToolWarning, `Expected a warning about 'my_custom_tool', got: ${JSON.stringify(result.warnings)}`);
});
