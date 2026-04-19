import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultRuntime } from "../src/default-runtime.js";

test("createDefaultRuntime registers zero-install and explicit provider handlers", () => {
  const runtime = createDefaultRuntime();

  assert.equal(typeof runtime.llms._auto, "function");
  assert.equal(typeof runtime.llms.gateway, "function");
  assert.equal(typeof runtime.llms["claude-cli"], "function");
  assert.equal(typeof runtime.llms.openai, "function");
});
