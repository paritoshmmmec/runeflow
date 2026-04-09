import test from "node:test";
import assert from "node:assert/strict";
import { expandEnvVars, deepExpandEnvVars, _resetEnvAllowlistCache } from "../src/utils.js";

// ─── expandEnvVars (low-level, allowlist-aware) ──────────────────────────────

test("expandEnvVars expands allowed variables", () => {
  process.env.__TEST_ALLOWED_KEY = "secret-123";
  try {
    const allowlist = new Set(["__TEST_ALLOWED_KEY"]);
    assert.equal(
      expandEnvVars("url=${__TEST_ALLOWED_KEY}/path", allowlist),
      "url=secret-123/path",
    );
  } finally {
    delete process.env.__TEST_ALLOWED_KEY;
  }
});

test("expandEnvVars blocks variables not in the allowlist", () => {
  process.env.__TEST_BLOCKED_KEY = "should-not-appear";
  const warnings = [];
  const original = process.stderr.write;
  process.stderr.write = (msg) => { warnings.push(msg); return true; };
  try {
    const allowlist = new Set(["SAFE_VAR"]);
    assert.equal(
      expandEnvVars("key=${__TEST_BLOCKED_KEY}", allowlist),
      "key=",
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /__TEST_BLOCKED_KEY/);
    assert.match(warnings[0], /RUNEFLOW_ENV_ALLOWLIST/);
  } finally {
    process.stderr.write = original;
    delete process.env.__TEST_BLOCKED_KEY;
  }
});

test("expandEnvVars allows everything when allowlist is null (bypass)", () => {
  process.env.__TEST_ANY_KEY = "any-value";
  try {
    assert.equal(
      expandEnvVars("val=${__TEST_ANY_KEY}", null),
      "val=any-value",
    );
  } finally {
    delete process.env.__TEST_ANY_KEY;
  }
});

test("expandEnvVars allows everything when no allowlist is passed", () => {
  process.env.__TEST_NO_LIST = "no-list-value";
  try {
    assert.equal(
      expandEnvVars("val=${__TEST_NO_LIST}"),
      "val=no-list-value",
    );
  } finally {
    delete process.env.__TEST_NO_LIST;
  }
});

// ─── deepExpandEnvVars (uses cached allowlist) ───────────────────────────────

test("deepExpandEnvVars expands default-listed provider keys", () => {
  _resetEnvAllowlistCache();
  delete process.env.RUNEFLOW_ENV_ALLOWLIST;
  process.env.CEREBRAS_API_KEY = "test-cerebras-key";
  try {
    const result = deepExpandEnvVars({
      url: "https://api.example.com",
      auth: "Bearer ${CEREBRAS_API_KEY}",
    });
    assert.equal(result.auth, "Bearer test-cerebras-key");
  } finally {
    delete process.env.CEREBRAS_API_KEY;
    _resetEnvAllowlistCache();
  }
});

test("deepExpandEnvVars blocks sensitive variables not in default allowlist", () => {
  _resetEnvAllowlistCache();
  delete process.env.RUNEFLOW_ENV_ALLOWLIST;
  process.env.AWS_SECRET_ACCESS_KEY = "super-secret";
  const warnings = [];
  const original = process.stderr.write;
  process.stderr.write = (msg) => { warnings.push(msg); return true; };
  try {
    const result = deepExpandEnvVars({
      headers: {
        Authorization: "${AWS_SECRET_ACCESS_KEY}",
      },
    });
    assert.equal(result.headers.Authorization, "");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /AWS_SECRET_ACCESS_KEY/);
  } finally {
    process.stderr.write = original;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    _resetEnvAllowlistCache();
  }
});

test("deepExpandEnvVars respects RUNEFLOW_ENV_ALLOWLIST extensions", () => {
  _resetEnvAllowlistCache();
  process.env.RUNEFLOW_ENV_ALLOWLIST = "CUSTOM_VAR,ANOTHER_VAR";
  process.env.CUSTOM_VAR = "custom-value";
  try {
    const result = deepExpandEnvVars("value=${CUSTOM_VAR}");
    assert.equal(result, "value=custom-value");
  } finally {
    delete process.env.RUNEFLOW_ENV_ALLOWLIST;
    delete process.env.CUSTOM_VAR;
    _resetEnvAllowlistCache();
  }
});

test("deepExpandEnvVars allows all vars when RUNEFLOW_ENV_ALLOWLIST=*", () => {
  _resetEnvAllowlistCache();
  process.env.RUNEFLOW_ENV_ALLOWLIST = "*";
  process.env.__ANYTHING = "all-access";
  try {
    const result = deepExpandEnvVars("val=${__ANYTHING}");
    assert.equal(result, "val=all-access");
  } finally {
    delete process.env.RUNEFLOW_ENV_ALLOWLIST;
    delete process.env.__ANYTHING;
    _resetEnvAllowlistCache();
  }
});

test("deepExpandEnvVars walks arrays and nested objects", () => {
  _resetEnvAllowlistCache();
  delete process.env.RUNEFLOW_ENV_ALLOWLIST;
  process.env.COMPOSIO_API_KEY = "composio-123";
  try {
    const result = deepExpandEnvVars({
      tools: ["tool1"],
      nested: {
        key: "${COMPOSIO_API_KEY}",
      },
    });
    assert.equal(result.nested.key, "composio-123");
    assert.deepEqual(result.tools, ["tool1"]);
  } finally {
    delete process.env.COMPOSIO_API_KEY;
    _resetEnvAllowlistCache();
  }
});
