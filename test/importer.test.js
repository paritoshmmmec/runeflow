import test from "node:test";
import assert from "node:assert/strict";
import { importMarkdownSkill } from "../src/importer.js";

test("importMarkdownSkill preserves docs and adds placeholder workflow", () => {
  const imported = importMarkdownSkill(`---
name: old-skill
description: Legacy skill
---

# Legacy

Follow these instructions carefully.
`);

  assert.match(imported, /name: old-skill/);
  assert.match(imported, /Follow these instructions carefully/);
  assert.match(imported, /step todo type=tool/);
});
