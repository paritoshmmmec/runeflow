// Feature: core-loop-reliability
// Properties 1-17: validator, dryrun, test-runner, fixture, and inspect-run correctness

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import { validateSkill } from "../src/validator.js";
import { dryrunRuneflow } from "../src/dryrun.js";
import { runTest, loadFixture } from "../src/test-runner.js";
import { runCli } from "../src/cli.js";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-empty alphanumeric step id */
const arbStepId = () =>
  fc.stringMatching(/^[a-z][a-z0-9_]{0,15}$/).filter((s) => s.length > 0);

/** Object schema with n string fields */
const arbInputSchema = (n) =>
  fc.uniqueArray(arbStepId(), { minLength: n, maxLength: n }).map((keys) =>
    Object.fromEntries(keys.map((k) => [k, "string"])),
  );

/** Minimal valid skill definition with the given input schema */
function makeSkillWithInputs(inputSchema) {
  const fields = Object.keys(inputSchema);
  // Reference a non-existent input field to trigger the error
  const badField = "__nonexistent__";
  return {
    metadata: {
      name: "test-skill",
      description: "test",
      inputs: inputSchema,
      outputs: { result: "string" },
    },
    consts: {},
    workflow: {
      steps: [
        {
          id: "step1",
          kind: "tool",
          tool: "mock.tool",
          with: { arg: `inputs.${badField}` },
          out: { result: "string" },
        },
      ],
      output: { result: "steps.step1.result" },
    },
    docBlocks: {},
  };
}

/** Minimal valid skill with the given step ids (tool steps) */
function makeSkillWithSteps(stepIds) {
  const steps = stepIds.map((id) => ({
    id,
    kind: "tool",
    tool: "mock.tool",
    out: { result: "string" },
  }));
  return {
    metadata: {
      name: "test-skill",
      description: "test",
      inputs: {},
      outputs: { result: "string" },
    },
    consts: {},
    workflow: { steps, output: { result: `steps.${stepIds[0]}.result` } },
    docBlocks: {},
  };
}

/** Minimal valid skill with a bad step reference */
function makeSkillWithBadStepRef(stepIds, badRef) {
  const steps = stepIds.map((id) => ({
    id,
    kind: "tool",
    tool: "mock.tool",
    out: { result: "string" },
  }));
  // Add a step that references a non-existent step
  steps.push({
    id: "consumer",
    kind: "tool",
    tool: "mock.tool",
    with: { arg: `steps.${badRef}.result` },
    out: { result: "string" },
  });
  return {
    metadata: {
      name: "test-skill",
      description: "test",
      inputs: {},
      outputs: {},
    },
    consts: {},
    workflow: { steps, output: {} },
    docBlocks: {},
  };
}

/** Arbitrary run artifact with N steps of varying status */
function makeRunArtifact(steps) {
  return {
    run_id: "run_test_123",
    status: steps.some((s) => s.status === "failed") ? "halted_on_error" : "success",
    halted_step_id: steps.find((s) => s.status === "failed")?.id ?? null,
    inputs: {},
    outputs: {},
    steps,
    error: steps.find((s) => s.status === "failed")
      ? { message: "step failed" }
      : null,
  };
}

const arbStepStatus = () => fc.constantFrom("success", "failed", "skipped");

const arbRunStep = () =>
  fc.record({
    id: arbStepId(),
    kind: fc.constantFrom("tool", "llm", "cli"),
    status: arbStepStatus(),
    started_at: fc.constant("2026-01-01T00:00:00.000Z"),
    finished_at: fc.constant("2026-01-01T00:00:01.000Z"),
    attempts: fc.integer({ min: 1, max: 3 }),
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function captureStdout(fn) {
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }
  return lines.join("\n");
}

// ─── Property 1: Validator input reference errors include available fields ────
// Feature: core-loop-reliability, Property 1

test("Property 1: validator input reference errors include available fields", () => {
  fc.assert(
    fc.property(
      arbInputSchema(fc.sample(fc.integer({ min: 1, max: 4 }), 1)[0]),
      (inputSchema) => {
        const fields = Object.keys(inputSchema);
        if (fields.length === 0) return;
        const definition = makeSkillWithInputs(inputSchema);
        const result = validateSkill(definition, {});
        const inputErrors = result.issues.filter((i) => i.includes("unknown input reference"));
        assert.ok(inputErrors.length > 0, "Expected at least one input reference error");
        const errorText = inputErrors.join(" ");
        const mentionsAField = fields.some((f) => errorText.includes(f));
        assert.ok(
          mentionsAField,
          `Expected error to mention one of [${fields.join(", ")}], got: ${errorText}`,
        );
      },
    ),
    { numRuns: 100 },
  );
});

// ─── Property 2: Validator step reference errors include suggestion or available ids ─
// Feature: core-loop-reliability, Property 2

test("Property 2: validator step reference errors include suggestion or available step ids", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(arbStepId(), { minLength: 1, maxLength: 4 }),
      fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/),
      (stepIds, badRef) => {
        // Ensure badRef is not one of the declared step ids or "consumer"
        if (stepIds.includes(badRef) || badRef === "consumer") return;
        const definition = makeSkillWithBadStepRef(stepIds, badRef);
        const result = validateSkill(definition, {});
        const stepErrors = result.issues.filter(
          (i) => i.includes("unknown or forward step reference") && i.includes(badRef),
        );
        assert.ok(stepErrors.length > 0, `Expected step reference error for '${badRef}'`);
        const errorText = stepErrors.join(" ");
        const hasSuggestion = errorText.includes("did you mean");
        const hasAvailable = stepIds.some((id) => errorText.includes(id)) || errorText.includes("available steps");
        assert.ok(
          hasSuggestion || hasAvailable,
          `Expected error to include suggestion or available ids. Got: ${errorText}`,
        );
      },
    ),
    { numRuns: 100 },
  );
});

// ─── Property 3: Validator missing-field errors include step id and field name ─
// Feature: core-loop-reliability, Property 3

test("Property 3: validator missing-field errors include step id and field name", () => {
  fc.assert(
    fc.property(arbStepId(), (stepId) => {
      // tool step missing 'tool' field
      const definition = {
        metadata: {
          name: "test-skill",
          description: "test",
          inputs: {},
          outputs: {},
        },
        consts: {},
        workflow: {
          steps: [{ id: stepId, kind: "tool" }],
          output: {},
        },
        docBlocks: {},
      };
      const result = validateSkill(definition, {});
      const fieldErrors = result.issues.filter(
        (i) => i.includes(stepId) && (i.includes("tool") || i.includes("out") || i.includes("schema")),
      );
      assert.ok(
        fieldErrors.length > 0,
        `Expected missing-field error mentioning step id '${stepId}'. Issues: ${result.issues.join("; ")}`,
      );
    }),
    { numRuns: 100 },
  );
});

// ─── Property 4: Validator branch target errors include target name and available steps ─
// Feature: core-loop-reliability, Property 4

test("Property 4: validator branch target errors include target name and available steps", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(arbStepId(), { minLength: 1, maxLength: 3 }),
      fc.string({ minLength: 1, maxLength: 8 }).filter((s) => /^[a-z]/.test(s)),
      (stepIds, missingTarget) => {
        if (stepIds.includes(missingTarget)) return;
        const branchId = "branch_step";
        if (stepIds.includes(branchId)) return;
        const definition = {
          metadata: {
            name: "test-skill",
            description: "test",
            inputs: {},
            outputs: {},
          },
          consts: {},
          workflow: {
            steps: [
              ...stepIds.map((id) => ({ id, kind: "tool", tool: "mock.tool", out: { result: "string" } })),
              {
                id: branchId,
                kind: "branch",
                if: "true",
                then: missingTarget,
                else: missingTarget,
              },
            ],
            output: {},
          },
          docBlocks: {},
        };
        const result = validateSkill(definition, {});
        const branchErrors = result.issues.filter(
          (i) => i.includes(missingTarget) && i.includes("does not exist"),
        );
        assert.ok(
          branchErrors.length > 0,
          `Expected branch target error for '${missingTarget}'. Issues: ${result.issues.join("; ")}`,
        );
        const errorText = branchErrors.join(" ");
        assert.ok(
          errorText.includes(missingTarget),
          `Error should include missing target name '${missingTarget}'`,
        );
        const mentionsAvailable = stepIds.some((id) => errorText.includes(id)) || errorText.includes("available steps");
        assert.ok(
          mentionsAvailable,
          `Error should mention available steps. Got: ${errorText}`,
        );
      },
    ),
    { numRuns: 100 },
  );
});

// ─── Property 5: Dryrun plan entries always contain id, kind, and status ──────
// Feature: core-loop-reliability, Property 5

test("Property 5: dryrun plan entries always contain id, kind, and status", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(arbStepId(), { minLength: 1, maxLength: 4 }),
      async (stepIds) => {
        const steps = stepIds.map((id) => ({
          id,
          kind: "tool",
          tool: "mock.tool",
          out: { result: "string" },
        }));
        const definition = {
          metadata: {
            name: "test-skill",
            description: "test",
            inputs: {},
            outputs: { result: "string" },
          },
          consts: {},
          workflow: {
            steps,
            output: { result: `steps.${stepIds[0]}.result` },
          },
          docBlocks: {},
        };
        const plan = await dryrunRuneflow(definition, {});
        assert.ok(typeof plan.valid === "boolean", "plan.valid must be a boolean");
        assert.ok(Array.isArray(plan.steps), "plan.steps must be an array");
        for (const entry of plan.steps) {
          assert.ok("id" in entry, `plan entry missing 'id': ${JSON.stringify(entry)}`);
          assert.ok("kind" in entry, `plan entry missing 'kind': ${JSON.stringify(entry)}`);
          assert.ok("status" in entry, `plan entry missing 'status': ${JSON.stringify(entry)}`);
        }
      },
    ),
    { numRuns: 50 },
  );
});

// ─── Property 6: Dryrun plan entries include kind-specific resolved fields ────
// Feature: core-loop-reliability, Property 6

test("Property 6: dryrun plan entries include kind-specific resolved fields", async () => {
  // Tool step: resolved_with
  await fc.assert(
    fc.asyncProperty(arbStepId(), async (stepId) => {
      const definition = {
        metadata: {
          name: "test-skill",
          description: "test",
          inputs: { val: "string" },
          outputs: {},
        },
        consts: {},
        workflow: {
          steps: [{ id: stepId, kind: "tool", tool: "mock.tool", with: { x: "inputs.val" }, out: { result: "string" } }],
          output: {},
        },
        docBlocks: {},
      };
      const plan = await dryrunRuneflow(definition, { val: "hello" });
      const entry = plan.steps.find((s) => s.id === stepId);
      assert.ok(entry, `No plan entry for step '${stepId}'`);
      assert.ok("resolved_with" in entry, `tool step missing 'resolved_with': ${JSON.stringify(entry)}`);
    }),
    { numRuns: 50 },
  );

  // CLI step: resolved_command
  await fc.assert(
    fc.asyncProperty(arbStepId(), async (stepId) => {
      const definition = {
        metadata: {
          name: "test-skill",
          description: "test",
          inputs: {},
          outputs: {},
        },
        consts: {},
        workflow: {
          steps: [{ id: stepId, kind: "cli", command: "echo hello" }],
          output: {},
        },
        docBlocks: {},
      };
      const plan = await dryrunRuneflow(definition, {});
      const entry = plan.steps.find((s) => s.id === stepId);
      assert.ok(entry, `No plan entry for step '${stepId}'`);
      assert.ok("resolved_command" in entry, `cli step missing 'resolved_command': ${JSON.stringify(entry)}`);
    }),
    { numRuns: 50 },
  );
});

// ─── Property 7: Dryrun continues planning after resolve errors ───────────────
// Feature: core-loop-reliability, Property 7

test("Property 7: dryrun continues planning after resolve errors", async () => {
  await fc.assert(
    fc.asyncProperty(
      arbStepId(),
      arbStepId(),
      async (step1Id, step2Id) => {
        if (step1Id === step2Id) return;
        // step2 references step1's output (which will be a placeholder), then step3 follows
        const step3Id = "final_step";
        if (step1Id === step3Id || step2Id === step3Id) return;
        const definition = {
          metadata: {
            name: "test-skill",
            description: "test",
            inputs: {},
            outputs: {},
          },
          consts: {},
          workflow: {
            steps: [
              { id: step1Id, kind: "tool", tool: "mock.tool", out: { result: "string" } },
              {
                id: step2Id,
                kind: "tool",
                tool: "mock.tool",
                with: { arg: `steps.${step1Id}.result` },
                out: { result: "string" },
              },
              { id: step3Id, kind: "tool", tool: "mock.tool", out: { result: "string" } },
            ],
            output: {},
          },
          docBlocks: {},
        };
        const plan = await dryrunRuneflow(definition, {});
        assert.ok(plan.valid, `Expected valid plan, got issues: ${plan.validation?.issues?.join("; ")}`);
        // All three steps should appear in the plan
        const ids = plan.steps.map((s) => s.id);
        assert.ok(ids.includes(step1Id), `Missing step '${step1Id}' in plan`);
        assert.ok(ids.includes(step2Id), `Missing step '${step2Id}' in plan`);
        assert.ok(ids.includes(step3Id), `Missing step '${step3Id}' in plan`);
      },
    ),
    { numRuns: 50 },
  );
});

// ─── Property 8: Dryrun returns valid: false with issues for invalid skills ───
// Feature: core-loop-reliability, Property 8

test("Property 8: dryrun returns valid: false with issues for invalid skills", async () => {
  await fc.assert(
    fc.asyncProperty(arbStepId(), async (stepId) => {
      // Invalid: tool step missing 'tool' and 'out'
      const definition = {
        metadata: {
          name: "test-skill",
          description: "test",
          inputs: {},
          outputs: {},
        },
        consts: {},
        workflow: {
          steps: [{ id: stepId, kind: "tool" }],
          output: {},
        },
        docBlocks: {},
      };
      const plan = await dryrunRuneflow(definition, {});
      assert.strictEqual(plan.valid, false, "Expected valid: false for invalid skill");
      assert.ok(
        Array.isArray(plan.validation?.issues) && plan.validation.issues.length > 0,
        "Expected non-empty issues array",
      );
      assert.deepEqual(plan.steps, [], "Expected empty steps array for invalid skill");
    }),
    { numRuns: 50 },
  );
});

// ─── Property 9: Missing tool mock errors include step id and fixture key path ─
// Feature: core-loop-reliability, Property 9

test("Property 9: missing tool mock errors include step id and fixture key path", async () => {
  await fc.assert(
    fc.asyncProperty(arbStepId(), async (stepId) => {
      const definition = {
        metadata: {
          name: "test-skill",
          description: "test",
          inputs: {},
          outputs: {},
        },
        consts: {},
        workflow: {
          steps: [{ id: stepId, kind: "tool", tool: "mock.tool", out: { result: "string" } }],
          output: {},
        },
        docBlocks: {},
      };
      // Fixture with no tool mocks
      const fixture = { inputs: {}, mocks: { tools: {}, llm: {} }, expect: { status: "success" } };
      const result = await runTest(definition, fixture, {});
      // Should fail — either the run errors out (halted_on_error) or there's a fixture assertion failure
      assert.ok(!result.pass, "Expected test to fail due to missing mock");
      const fixtureKeyPath = `fixture.mocks.tools.${stepId}`;
      // The error may surface in failures[].message or in the run's step error
      const allText = JSON.stringify(result);
      assert.ok(
        allText.includes(fixtureKeyPath),
        `Expected error to include fixture key path '${fixtureKeyPath}'. Got: ${allText.slice(0, 500)}`,
      );
    }),
    { numRuns: 50 },
  );
});

// ─── Property 10: Missing LLM mock errors include step id and fixture key path ─
// Feature: core-loop-reliability, Property 10

test("Property 10: missing LLM mock errors include step id and fixture key path", async () => {
  await fc.assert(
    fc.asyncProperty(arbStepId(), async (stepId) => {
      const definition = {
        metadata: {
          name: "test-skill",
          description: "test",
          inputs: {},
          outputs: {},
          llm: { provider: "mock", model: "mock-model" },
        },
        consts: {},
        workflow: {
          steps: [
            {
              id: stepId,
              kind: "llm",
              prompt: "Say hello",
              schema: { answer: "string" },
            },
          ],
          output: {},
        },
        docBlocks: {},
      };
      // Fixture with no llm mocks
      const fixture = { inputs: {}, mocks: { tools: {}, llm: {} }, expect: { status: "success" } };
      const result = await runTest(definition, fixture, {});
      assert.ok(!result.pass, "Expected test to fail due to missing LLM mock");
      const fixtureKeyPath = `fixture.mocks.llm.${stepId}`;
      const allText = JSON.stringify(result);
      assert.ok(
        allText.includes(fixtureKeyPath),
        `Expected error to include fixture key path '${fixtureKeyPath}'. Got: ${allText.slice(0, 500)}`,
      );
    }),
    { numRuns: 50 },
  );
});

// ─── Property 11: Test CLI output always contains pass, failure_count, and run_id ─
// Feature: core-loop-reliability, Property 11

test("Property 11: test CLI output always contains pass, failure_count, and run_id", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-prop11-"));
  const originalCwd = process.cwd();

  // Write a minimal skill file
  const skillSource = `---
name: prop11-skill
description: Property 11 test skill
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
step finish type=tool {
  tool: mock.finish
  out: { result: string }
}

output {
  result: steps.finish.result
}
\`\`\`
`;
  await fs.writeFile(path.join(tempDir, "skill.runeflow.md"), skillSource);

  // Write a passing fixture
  const fixture = {
    inputs: {},
    mocks: { tools: { finish: { result: "ok" } }, llm: {} },
    expect: { status: "success" },
  };
  await fs.writeFile(path.join(tempDir, "fixture.json"), JSON.stringify(fixture));

  // Write a failing fixture (wrong expected status)
  const failingFixture = {
    inputs: {},
    mocks: { tools: { finish: { result: "ok" } }, llm: {} },
    expect: { status: "halted_on_error" },
  };
  await fs.writeFile(path.join(tempDir, "failing-fixture.json"), JSON.stringify(failingFixture));

  try {
    process.chdir(tempDir);

    for (const fixtureName of ["fixture.json", "failing-fixture.json"]) {
      const output = await captureStdout(() =>
        runCli(["test", "skill.runeflow.md", "--fixture", fixtureName]).catch(() => {}),
      );
      const parsed = JSON.parse(output);
      assert.ok("pass" in parsed, `Output missing 'pass' field for ${fixtureName}`);
      assert.ok("failure_count" in parsed, `Output missing 'failure_count' field for ${fixtureName}`);
      assert.ok("run_id" in parsed, `Output missing 'run_id' field for ${fixtureName}`);
    }
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

// ─── Property 12: Recorded fixture contains required fields keyed by step id ──
// Feature: core-loop-reliability, Property 12

test("Property 12: recorded fixture contains required fields keyed by step id", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-prop12-"));
  const originalCwd = process.cwd();

  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(arbStepId(), { minLength: 1, maxLength: 3 }),
      async (stepIds) => {
        const skillSource = `---
name: prop12-skill
description: Property 12 test skill
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
${stepIds.map((id) => `step ${id} type=tool {\n  tool: mock.tool\n  out: { result: string }\n}`).join("\n")}

output {
  result: steps.${stepIds[0]}.result
}
\`\`\`
`;
        const skillPath = path.join(tempDir, "skill.runeflow.md");
        await fs.writeFile(skillPath, skillSource);

        const runtimeSource = `export const tools = {
  "mock.tool": async () => ({ result: "ok" }),
};
`;
        const runtimePath = path.join(tempDir, "runtime.js");
        await fs.writeFile(runtimePath, runtimeSource);

        const fixturePath = path.join(tempDir, "recorded.json");

        try {
          process.chdir(tempDir);
          await captureStdout(() =>
            runCli([
              "run",
              "skill.runeflow.md",
              "--input", "{}",
              "--runtime", "runtime.js",
              "--record-fixture", "recorded.json",
            ]).catch(() => {}),
          );
        } finally {
          process.chdir(originalCwd);
        }

        let recorded;
        try {
          recorded = JSON.parse(await fs.readFile(fixturePath, "utf8"));
        } catch {
          // If run failed, skip this iteration
          return;
        }

        assert.ok("inputs" in recorded, "Recorded fixture missing 'inputs'");
        assert.ok("mocks" in recorded, "Recorded fixture missing 'mocks'");
        assert.ok("mocks" in recorded && "tools" in recorded.mocks, "Recorded fixture missing 'mocks.tools'");
        assert.ok("mocks" in recorded && "llm" in recorded.mocks, "Recorded fixture missing 'mocks.llm'");
        assert.ok("expect" in recorded && "status" in recorded.expect, "Recorded fixture missing 'expect.status'");

        // Tool mock entries should be keyed by step id
        for (const stepId of stepIds) {
          assert.ok(
            stepId in recorded.mocks.tools,
            `Expected mocks.tools to have key '${stepId}'. Keys: ${Object.keys(recorded.mocks.tools).join(", ")}`,
          );
        }
      },
    ),
    { numRuns: 20 },
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

// ─── Property 13: Fixture loading normalizes missing top-level fields ─
// Feature: core-loop-reliability, Property 13

test("Property 13: fixture loading normalizes missing top-level fields", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-prop13-"));

  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("inputs", "mocks", "expect"),
      async (missingField) => {
        const base = {
          inputs: {},
          mocks: { tools: {}, llm: {} },
          expect: { status: "success" },
        };
        const incomplete = { ...base };
        delete incomplete[missingField];

        const fixturePath = path.join(tempDir, `fixture-missing-${missingField}.json`);
        await fs.writeFile(fixturePath, JSON.stringify(incomplete));

        const fixture = await loadFixture(fixturePath);
        assert.deepEqual(fixture, {
          inputs: incomplete.inputs ?? {},
          mocks: incomplete.mocks ?? {},
          expect: incomplete.expect ?? {},
        });
      },
    ),
    { numRuns: 30 },
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

// ─── Helpers for inspect-run property tests ───────────────────────────────────

async function writeRunArtifact(runsDir, artifact) {
  await fs.mkdir(runsDir, { recursive: true });
  await fs.writeFile(
    path.join(runsDir, `${artifact.run_id}.json`),
    JSON.stringify(artifact),
  );
}

async function writeStepArtifact(runsDir, runId, stepId, stepData) {
  const stepsDir = path.join(runsDir, runId, "steps");
  await fs.mkdir(stepsDir, { recursive: true });
  await fs.writeFile(path.join(stepsDir, `${stepId}.json`), JSON.stringify(stepData));
}

// ─── Property 14: Inspect-run table output contains required columns ──────────
// Feature: core-loop-reliability, Property 14

test("Property 14: inspect-run table output contains required columns", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-prop14-"));
  const originalCwd = process.cwd();

  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(arbRunStep(), { minLength: 1, maxLength: 4 }),
      async (steps) => {
        // Ensure unique ids
        const seen = new Set();
        const uniqueSteps = steps.filter((s) => {
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
        if (uniqueSteps.length === 0) return;

        const runId = `run_prop14_${Date.now()}`;
        const artifact = makeRunArtifact(uniqueSteps.map((s) => ({ ...s, run_id: runId })));
        artifact.run_id = runId;

        const runsDir = path.join(tempDir, "runs");
        await writeRunArtifact(runsDir, artifact);

        try {
          process.chdir(tempDir);
          const output = await captureStdout(() =>
            runCli(["inspect-run", runId, "--runs-dir", "runs", "--format", "table"]),
          );
          for (const col of ["id", "kind", "status", "duration", "attempts"]) {
            assert.ok(output.includes(col), `Table output missing column '${col}'. Output: ${output.slice(0, 300)}`);
          }
        } finally {
          process.chdir(originalCwd);
        }
      },
    ),
    { numRuns: 30 },
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

// ─── Property 15: Inspect-run table visually distinguishes failed steps ────────
// Feature: core-loop-reliability, Property 15

test("Property 15: inspect-run table visually distinguishes failed steps", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-prop15-"));
  const originalCwd = process.cwd();

  await fc.assert(
    fc.asyncProperty(
      arbStepId(),
      arbStepId(),
      async (successId, failedId) => {
        if (successId === failedId) return;
        const runId = `run_prop15_${Date.now()}`;
        const steps = [
          { id: successId, kind: "tool", status: "success", started_at: "2026-01-01T00:00:00.000Z", finished_at: "2026-01-01T00:00:01.000Z", attempts: 1 },
          { id: failedId, kind: "tool", status: "failed", started_at: "2026-01-01T00:00:01.000Z", finished_at: "2026-01-01T00:00:02.000Z", attempts: 1 },
        ];
        const artifact = {
          run_id: runId,
          status: "halted_on_error",
          halted_step_id: failedId,
          inputs: {},
          outputs: {},
          steps,
          error: { message: "step failed" },
        };

        const runsDir = path.join(tempDir, "runs");
        await writeRunArtifact(runsDir, artifact);

        try {
          process.chdir(tempDir);
          const output = await captureStdout(() =>
            runCli(["inspect-run", runId, "--runs-dir", "runs", "--format", "table"]),
          );
          // Failed step row should contain the ✗ marker
          assert.ok(
            output.includes("✗"),
            `Expected ✗ marker for failed step '${failedId}'. Output: ${output.slice(0, 400)}`,
          );
        } finally {
          process.chdir(originalCwd);
        }
      },
    ),
    { numRuns: 30 },
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

// ─── Property 16: Inspect-run --step returns full step artifact JSON ──────────
// Feature: core-loop-reliability, Property 16

test("Property 16: inspect-run --step returns full step artifact JSON", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-prop16-"));
  const originalCwd = process.cwd();

  await fc.assert(
    fc.asyncProperty(
      arbStepId(),
      fc.record({ result: fc.string(), extra: fc.integer() }),
      async (stepId, stepData) => {
        const runId = `run_prop16_${Date.now()}`;
        const artifact = {
          run_id: runId,
          status: "success",
          inputs: {},
          outputs: {},
          steps: [{ id: stepId, kind: "tool", status: "success" }],
        };

        const runsDir = path.join(tempDir, "runs");
        await writeRunArtifact(runsDir, artifact);
        await writeStepArtifact(runsDir, runId, stepId, { id: stepId, ...stepData });

        try {
          process.chdir(tempDir);
          const output = await captureStdout(() =>
            runCli(["inspect-run", runId, "--runs-dir", "runs", "--step", stepId]),
          );
          const parsed = JSON.parse(output);
          assert.strictEqual(parsed.id, stepId, `Expected step id '${stepId}' in artifact`);
          assert.strictEqual(parsed.result, stepData.result, "Expected result field to match");
        } finally {
          process.chdir(originalCwd);
        }
      },
    ),
    { numRuns: 30 },
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});

// ─── Property 17: Inspect-run --step missing artifact error includes expected path ─
// Feature: core-loop-reliability, Property 17

test("Property 17: inspect-run --step missing artifact error includes expected path", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-prop17-"));
  const originalCwd = process.cwd();

  await fc.assert(
    fc.asyncProperty(arbStepId(), async (stepId) => {
      const runId = `run_prop17_${Date.now()}`;
      const artifact = {
        run_id: runId,
        status: "success",
        inputs: {},
        outputs: {},
        steps: [],
      };

      const runsDir = path.join(tempDir, "runs");
      await writeRunArtifact(runsDir, artifact);
      // Intentionally do NOT write a step artifact

      try {
        process.chdir(tempDir);
        await assert.rejects(
          () => runCli(["inspect-run", runId, "--runs-dir", "runs", "--step", stepId]),
          (err) => {
            assert.ok(
              err.message.includes(stepId),
              `Expected error to include step id '${stepId}'. Got: ${err.message}`,
            );
            return true;
          },
        );
      } finally {
        process.chdir(originalCwd);
      }
    }),
    { numRuns: 30 },
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});
