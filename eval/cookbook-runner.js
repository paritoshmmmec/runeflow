/**
 * Cookbook eval runner.
 *
 * Runs all cookbook skills against their fixtures and reports results.
 * Exits non-zero if any skill fails — safe to run in CI or a watch loop.
 *
 * Usage:
 *   node eval/cookbook-runner.js
 *   node eval/cookbook-runner.js --skill notify-slack
 *   node eval/cookbook-runner.js --format table
 *   node eval/cookbook-runner.js --live          # uses real APIs (needs env vars)
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseRuneflow } from "../src/parser.js";
import { runRuneflow } from "../src/runtime.js";
import { validateRuneflow } from "../src/validator.js";
import { createDefaultRuntime } from "../src/default-runtime.js";

const REPO_ROOT = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

// ─── Skill registry ──────────────────────────────────────────────────────────

const SKILLS = [
  {
    name: "notify-slack",
    skill: "eval/cookbook/notify-slack.md",
    fixture: "eval/cookbook/fixtures/notify-slack.json",
    runtime: "eval/cookbook/runtimes/notify-slack-runtime.js",
  },
  {
    name: "create-linear-issue",
    skill: "eval/cookbook/create-linear-issue.md",
    fixture: "eval/cookbook/fixtures/create-linear-issue.json",
    runtime: "eval/cookbook/runtimes/create-linear-issue-runtime.js",
  },
  {
    name: "weekly-digest",
    skill: "eval/cookbook/weekly-digest.md",
    fixture: "eval/cookbook/fixtures/weekly-digest.json",
    runtime: "eval/cookbook/runtimes/weekly-digest-runtime.js",
  },
];

// ─── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { skill: null, format: "table", live: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skill") opts.skill = argv[++i];
    else if (argv[i] === "--format") opts.format = argv[++i];
    else if (argv[i] === "--live") opts.live = true;
  }
  return opts;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loadJson(relPath) {
  return JSON.parse(await fs.readFile(path.resolve(REPO_ROOT, relPath), "utf8"));
}

async function loadSkill(relPath) {
  const absPath = path.resolve(REPO_ROOT, relPath);
  const source = await fs.readFile(absPath, "utf8");
  return parseRuneflow(source, { sourcePath: absPath });
}

async function loadRuntime(relPath) {
  const absPath = path.resolve(REPO_ROOT, relPath);
  const mod = await import(pathToFileURL(absPath).href);
  return mod.default ?? mod;
}

/**
 * Build a mock runtime from a fixture's mocks block.
 * Tool mocks keyed by step id; the harness maps them to the actual tool name
 * by inspecting the skill definition's steps.
 */
function buildMockRuntime(fixture, liveRuntime, definition) {
  const toolMocks = fixture.mocks?.tools ?? {};
  const llmMocks = fixture.mocks?.llm ?? {};

  // Build a step-id → tool-name map from the definition
  const stepToolMap = new Map(
    (definition.workflow?.steps ?? [])
      .filter((s) => s.kind === "tool" && s.tool)
      .map((s) => [s.id, s.tool]),
  );

  // Register mocks under the actual tool name (looked up via step id)
  // Also accept direct tool-name keys as a fallback
  const toolOverrides = {};
  for (const [key, output] of Object.entries(toolMocks)) {
    const toolName = stepToolMap.get(key) ?? key;
    toolOverrides[toolName] = async () => output;
  }

  const tools = { ...(liveRuntime.tools ?? {}), ...toolOverrides };

  // Build mock LLM handlers keyed by step id
  const llmHandler = async (payload) => {
    const stepId = payload.step?.id;
    if (stepId && llmMocks[stepId]) return llmMocks[stepId];
    const first = Object.values(llmMocks)[0];
    if (first) return first;
    throw new Error(`No LLM mock for step '${stepId}'. Add it to the fixture or run with --live.`);
  };

  const defaultRuntime = createDefaultRuntime();
  const llms = Object.fromEntries(
    Object.keys(defaultRuntime.llms ?? { cerebras: true, openai: true, anthropic: true }).map(
      (provider) => [provider, llmHandler],
    ),
  );

  return { ...liveRuntime, tools, llms };
}

// ─── Single skill runner ──────────────────────────────────────────────────────

async function runSkillEntry(entry, opts) {
  const startedAt = Date.now();
  const result = {
    name: entry.name,
    validate: null,
    run: null,
    assertions: [],
    pass: false,
    durationMs: 0,
    error: null,
  };

  try {
    const [definition, fixture, liveRuntime] = await Promise.all([
      loadSkill(entry.skill),
      loadJson(entry.fixture),
      loadRuntime(entry.runtime),
    ]);

    // 1. Validate
    const validation = validateRuneflow(definition);
    result.validate = { valid: validation.valid, issues: validation.issues, warnings: validation.warnings };
    if (!validation.valid) {
      result.error = `Validation failed: ${validation.issues.join("; ")}`;
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    // 2. Run against fixture mocks (or live if --live)
    const runtime = opts.live ? liveRuntime : buildMockRuntime(fixture, liveRuntime, definition);
    const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), `runeflow-cookbook-${entry.name}-`));

    const promptValues = fixture.prompt_values ?? {};

    const run = await runRuneflow(definition, fixture.inputs, runtime, {
      runsDir,
      promptValues,
      checkAuth: false,
    });

    result.run = {
      status: run.status,
      run_id: run.run_id,
      error: run.error ?? null,
      steps: run.steps.map((s) => ({ id: s.id, status: s.status, error: s.error ?? null })),
    };

    // 3. Assert expected status
    const expectedStatus = fixture.expect?.status ?? "success";
    if (run.status !== expectedStatus) {
      result.assertions.push({
        path: "run.status",
        expected: expectedStatus,
        actual: run.status,
        pass: false,
      });
    } else {
      result.assertions.push({ path: "run.status", expected: expectedStatus, actual: run.status, pass: true });
    }

    // 4. Assert expected outputs
    const expectedOutputs = fixture.expect?.outputs ?? {};
    for (const [key, expected] of Object.entries(expectedOutputs)) {
      const actual = run.outputs?.[key];
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      result.assertions.push({ path: `outputs.${key}`, expected, actual, pass });
    }

    result.pass = result.assertions.every((a) => a.pass);
  } catch (err) {
    result.error = err.message;
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}

// ─── Reporters ────────────────────────────────────────────────────────────────

function reportTable(results) {
  const cols = ["name", "validate", "run", "assertions", "duration"];
  const rows = results.map((r) => ({
    name: r.name,
    validate: r.validate?.valid ? "✓" : `✗ ${r.validate?.issues?.length ?? "?"} issues`,
    run: r.run ? (r.run.status === "success" ? "✓ success" : `✗ ${r.run.status}`) : (r.error ? `✗ error` : "-"),
    assertions: r.pass
      ? `✓ ${r.assertions.length}/${r.assertions.length}`
      : `✗ ${r.assertions.filter((a) => !a.pass).length} failed`,
    duration: `${r.durationMs}ms`,
  }));

  const widths = cols.map((col) =>
    Math.max(col.length, ...rows.map((r) => String(r[col]).length)),
  );
  const divider = widths.map((w) => "─".repeat(w)).join("  ");
  const header = cols.map((col, i) => col.padEnd(widths[i])).join("  ");

  console.log(`\nCookbook eval  ${new Date().toISOString()}\n`);
  console.log(divider);
  console.log(header);
  console.log(divider);
  for (const row of rows) {
    console.log(cols.map((col, i) => String(row[col]).padEnd(widths[i])).join("  "));
  }
  console.log(divider);

  // Print failures in detail
  for (const r of results) {
    if (r.pass) continue;
    console.log(`\n  ${r.name} — failures:`);
    if (r.error) {
      console.log(`    error: ${r.error}`);
    }
    for (const a of r.assertions.filter((a) => !a.pass)) {
      console.log(`    ${a.path}`);
      console.log(`      expected: ${JSON.stringify(a.expected)}`);
      console.log(`      actual:   ${JSON.stringify(a.actual)}`);
    }
    if (r.run?.steps) {
      const failed = r.run.steps.filter((s) => s.status === "failed");
      for (const s of failed) {
        console.log(`    step '${s.id}' failed: ${s.error?.message ?? "unknown"}`);
      }
    }
  }
}

function reportJson(results) {
  console.log(JSON.stringify({
    ranAt: new Date().toISOString(),
    pass: results.every((r) => r.pass),
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
  }, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  process.chdir(REPO_ROOT);

  const skills = opts.skill
    ? SKILLS.filter((s) => s.name === opts.skill)
    : SKILLS;

  if (skills.length === 0) {
    console.error(`No skill found matching '${opts.skill}'. Available: ${SKILLS.map((s) => s.name).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  // Run all skills (sequentially to keep output readable)
  const results = [];
  for (const entry of skills) {
    process.stderr.write(`  running ${entry.name}…\n`);
    results.push(await runSkillEntry(entry, opts));
  }

  if (opts.format === "json") {
    reportJson(results);
  } else {
    reportTable(results);
  }

  const allPass = results.every((r) => r.pass);
  if (!allPass) process.exitCode = 1;
}

await main();
