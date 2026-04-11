import test from "node:test";
import assert from "node:assert/strict";
import { linear } from "../providers/linear/tools.js";
import { schemas } from "../providers/linear/schemas.js";

test("linear tools export matches schemas", () => {
  const tools = linear({ apiKey: "test" });
  const schemaNames = new Set(schemas.map((s) => s.name));

  for (const toolName of Object.keys(tools)) {
    assert.ok(schemaNames.has(toolName), `Missing schema for ${toolName}`);
  }
  for (const schemaName of schemaNames) {
    assert.ok(tools[schemaName], `Missing implementation for ${schemaName}`);
  }
});
