import test from "node:test";
import assert from "node:assert/strict";
import { importMarkdownRuneflow } from "../src/importer.js";
import { parseRuneflow } from "../src/parser.js";

test("importMarkdownRuneflow preserves docs and adds placeholder workflow", () => {
  const imported = importMarkdownRuneflow(`---
name: old-skill
description: Legacy skill
---

# Legacy

Follow these instructions carefully.
`);

  assert.match(imported, /name: old-skill/);
  assert.match(imported, /Follow these instructions carefully/);
  assert.match(imported, /step todo type=tool/);
  assert.match(imported, /```runeflow/);
});

test("importMarkdownRuneflow preserves YAML-safe metadata for round-trip parsing", () => {
  const imported = importMarkdownRuneflow(`---
name: old-skill
description: "Create: PR"
---

# Legacy

Follow these instructions carefully.
`);

  const parsed = parseRuneflow(imported);
  assert.equal(parsed.metadata.name, "old-skill");
  assert.equal(parsed.metadata.description, "Create: PR");
});
