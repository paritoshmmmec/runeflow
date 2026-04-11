import test from "node:test";
import assert from "node:assert/strict";
import { github } from "../providers/github/tools.js";
import { schemas } from "../providers/github/schemas.js";

test("github tools export matches schemas", () => {
  const tools = github({ token: "test" });
  const schemaNames = new Set(schemas.map((s) => s.name));

  for (const toolName of Object.keys(tools)) {
    assert.ok(schemaNames.has(toolName), `Missing schema for ${toolName}`);
  }
  for (const schemaName of schemaNames) {
    assert.ok(tools[schemaName], `Missing implementation for ${schemaName}`);
  }
});
