/**
 * runeflow test
 *
 * Runs a .runeflow.md against a fixture file. Mocks all LLM and tool calls using
 * the fixture's `mocks` section. Asserts status, outputs, and per-step
 * outcomes against the `expect` section.
 *
 * No real tool calls, no real LLM calls, no shell commands.
 * Every run writes artifacts to runsDir just like a real run.
 *
 * Fixture format:
 * {
 *   "inputs": { "base_branch": "main" },
 *   "mocks": {
 *     "tools": {
 *       "current_branch": { "branch": "feat/x" }
 *     },
 *     "llm": {
 *       "draft": { "title": "feat: x", "body": "Body." }
 *     }
 *   },
 *   "expect": {
 *     "status": "success",
 *     "outputs": { "title": "feat: x" },
 *     "calls": {
 *       "tools": {
 *         "current_branch": [{}]
 *       },
 *       "llm": {
 *         "draft": [{ "prompt": "Draft for feat/x", "input": {} }]
 *       }
 *     },
 *     "steps": { "draft": { "status": "success" } }
 *   }
 * }
 */

import path from "node:path";
import fs from "node:fs/promises";
import { runRuneflow } from "./runtime.js";

// ─── Assertion helpers ────────────────────────────────────────────────────────

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function collectFailures(expected, actual, parentPath) {
  const failures = [];

  if (expected === null || expected === undefined) return failures;

  if (typeof expected !== "object" || Array.isArray(expected)) {
    if (!deepEqual(expected, actual)) {
      failures.push({
        path: parentPath,
        expected,
        actual,
        message: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      });
    }
    return failures;
  }

  for (const [key, value] of Object.entries(expected)) {
    const childPath = parentPath ? `${parentPath}.${key}` : key;
    const actualValue = actual == null ? undefined : actual[key];
    failures.push(...collectFailures(value, actualValue, childPath));
  }

  return failures;
}

// ─── Mock runtime builder ─────────────────────────────────────────────────────

/**
 * Builds a mock runtime that intercepts all tool and LLM calls.
 */
function buildMockRuntime(mocks = {}, definition = {}) {
  const toolMocks = mocks.tools ?? {};
  const llmMocks = mocks.llm ?? {};
  const toolCalls = {};
  const toolCallsByStep = {};
  const llmCalls = {};

  // We build a plain object for llms so it survives spreading in runtime.js
  const llms = {};
  const mockLlmHandler = async ({ step, input, prompt }) => {
    const stepId = step.id;
    llmCalls[stepId] = llmCalls[stepId] ?? [];
    llmCalls[stepId].push({ step: stepId, prompt, input });

    if (!Object.prototype.hasOwnProperty.call(llmMocks, stepId)) {
      throw new Error(
        `No mock defined for llm step '${stepId}'. Add it to fixture at: fixture.mocks.llm.${stepId}`,
      );
    }
    const mockValue = llmMocks[stepId];
    return typeof mockValue === "function" ? mockValue({ step, input, prompt }) : mockValue;
  };

  // Identify all providers used in the skill
  const providers = new Set();
  if (definition.metadata?.llm?.provider) providers.add(definition.metadata.llm.provider);
  if (definition.workflow?.steps) {
    for (const step of definition.workflow.steps) {
      if (step.kind === "llm" && step.llm?.provider) {
        providers.add(step.llm.provider);
      }
    }
  }
  // Default fallback providers
  providers.add("openai");
  providers.add("anthropic");
  providers.add("mock");

  for (const p of providers) {
    llms[p] = mockLlmHandler;
  }

  // Same for tools
  const tools = {};
  const declaredToolNames = new Set(
    (definition.workflow?.steps ?? [])
      .filter((step) => step.kind === "tool")
      .map((step) => step.tool),
  );

  for (const [key] of Object.entries(toolMocks)) {
    const matchingStep = definition.workflow?.steps?.find((step) => step.kind === "tool" && step.id === key);
    declaredToolNames.add(matchingStep?.tool ?? key);
  }

  for (const toolName of declaredToolNames) {
    tools[toolName] = async (input, context = {}) => {
      const stepId = context.step?.id ?? null;
      toolCalls[toolName] = toolCalls[toolName] ?? [];
      toolCalls[toolName].push(input);

      if (stepId) {
        toolCallsByStep[stepId] = toolCallsByStep[stepId] ?? [];
        toolCallsByStep[stepId].push(input);
      }

      const mockKey = stepId && Object.prototype.hasOwnProperty.call(toolMocks, stepId)
        ? stepId
        : toolName;

      if (!Object.prototype.hasOwnProperty.call(toolMocks, mockKey)) {
        if (stepId) {
          throw new Error(
            `No mock defined for tool step '${stepId}'. Add it to fixture at: fixture.mocks.tools.${stepId}`,
          );
        }
        throw new Error(`No mock defined for tool '${toolName}'. Add it to fixture at: fixture.mocks.tools.${toolName}`);
      }

      const mockValue = toolMocks[mockKey];
      return typeof mockValue === "function" ? mockValue(input, context) : mockValue;
    };
  }

  return {
    tools,
    llms,
    _toolCalls: toolCalls,
    _toolCallsByStep: toolCallsByStep,
    _llmCalls: llmCalls,
  };
}


// ─── Assertion runner ─────────────────────────────────────────────────────────

function assertRun(run, expect_, calls = {}) {
  const failures = [];

  if (expect_ == null) return failures;

  // Top-level status
  if (expect_.status !== undefined) {
    failures.push(...collectFailures(expect_.status, run.status, "status"));
  }

  // Top-level outputs
  if (expect_.outputs !== undefined) {
    failures.push(...collectFailures(expect_.outputs, run.outputs, "outputs"));
  }

  if (expect_.calls?.tools !== undefined) {
    failures.push(...collectFailures(expect_.calls.tools, calls.toolCallsByStep, "calls.tools"));
  }

  if (expect_.calls?.tools_by_name !== undefined) {
    failures.push(...collectFailures(expect_.calls.tools_by_name, calls.toolCalls, "calls.tools_by_name"));
  }

  if (expect_.calls?.llm !== undefined) {
    failures.push(...collectFailures(expect_.calls.llm, calls.llmCalls, "calls.llm"));
  }

  // Per-step assertions
  if (expect_.steps) {
    const stepMap = Object.fromEntries((run.steps ?? []).map((s) => [s.id, s]));
    for (const [stepId, expectedStep] of Object.entries(expect_.steps)) {
      const actualStep = stepMap[stepId];
      if (!actualStep) {
        failures.push({
          path: `steps.${stepId}`,
          expected: expectedStep,
          actual: undefined,
          message: `step '${stepId}' did not run`,
        });
        continue;
      }
      failures.push(...collectFailures(expectedStep, actualStep, `steps.${stepId}`));
    }
  }

  return failures;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs a runeflow definition against a fixture.
 *
 * @param {object} definition  - Parsed runeflow definition
 * @param {object} fixture     - { inputs, mocks, expect }
 * @param {object} options     - { runsDir, runtime }
 * @returns {Promise<TestResult>}
 */
export async function runTest(definition, fixture, options = {}) {
  const { runsDir, runtime: baseRuntime = {} } = options;
  const inputs = fixture.inputs ?? {};
  const mockRuntime = buildMockRuntime(fixture.mocks, definition);

  // Merge mock runtime on top of any base runtime provided, so mock tools
  // and llms win. Base runtime still contributes plugins and hooks.
  const mergedRuntime = {
    ...baseRuntime,
    tools: {
      ...(baseRuntime.tools ?? {}),
      ...mockRuntime.tools,
    },
    llms: mockRuntime.llms,
    _toolCalls: mockRuntime._toolCalls,
    _toolCallsByStep: mockRuntime._toolCallsByStep,
    _llmCalls: mockRuntime._llmCalls,
  };

  let run;
  let runError = null;

  try {
    run = await runRuneflow(definition, inputs, mergedRuntime, { runsDir });
  } catch (error) {
    runError = error;
  }

  if (runError) {
    const failure = {
      path: "run",
      expected: { status: fixture.expect?.status ?? "success" },
      actual: { error: runError.message },
      message: `.runeflow.md threw an unexpected error: ${runError.message}`,
    };
    return {
      pass: false,
      failures: [failure],
      run: null,
      toolCalls: mockRuntime._toolCalls,
      toolCallsByStep: mockRuntime._toolCallsByStep,
      llmCalls: mockRuntime._llmCalls,
    };
  }

  const failures = assertRun(run, fixture.expect, {
    toolCalls: mockRuntime._toolCalls,
    toolCallsByStep: mockRuntime._toolCallsByStep,
    llmCalls: mockRuntime._llmCalls,
  });

  return {
    pass: failures.length === 0,
    failures,
    run,
    toolCalls: mockRuntime._toolCalls,
    toolCallsByStep: mockRuntime._toolCallsByStep,
    llmCalls: mockRuntime._llmCalls,
  };
}

/**
 * Loads a fixture from a JSON file path.
 *
 * @param {string} fixturePath - Absolute or cwd-relative path to fixture JSON
 * @returns {Promise<object>}  - Parsed fixture object
 */
export async function loadFixture(fixturePath) {
  const absolutePath = path.resolve(process.cwd(), fixturePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const fixture = JSON.parse(raw);
  return {
    inputs: fixture.inputs ?? {},
    mocks: fixture.mocks ?? {},
    expect: fixture.expect ?? {},
  };
}
