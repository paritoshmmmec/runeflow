#!/usr/bin/env node
/**
 * run-scripted.js (Loop B)
 *
 * For the named scenario:
 *   1. validate scenarios/<name>/reference.md          (runeflow validate)
 *   2. runeflow test ... --fixture fixture.json        (mocked run + assertions)
 *   3. concept count on reference.md vs budget.json
 *
 * Exits 0 on pass, 1 on any failure. Prints a human-readable summary and a
 * machine-readable JSON line.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseSkill } from "../../src/index.js";
import { countConcepts } from "./concept-counter.js";

const __filename = fileURLToPath(import.meta.url);
const HARNESS_DIR = path.dirname(__filename);
const REPO_ROOT = path.resolve(HARNESS_DIR, "../..");
const BIN = path.join(REPO_ROOT, "bin", "runeflow.js");

function fail(result, reason, detail) {
  result.checks.push({ name: reason, ok: false, detail });
  return result;
}
function pass(result, name) {
  result.checks.push({ name, ok: true });
  return result;
}

function buildStepIdMap(referenceSource, candidateSource) {
  const reference = parseSkill(referenceSource);
  const candidate = parseSkill(candidateSource);
  const kinds = ["tool", "llm", "cli", "transform", "branch", "parallel", "block", "human_input", "fail"];
  const idMap = new Map();

  for (const kind of kinds) {
    const referenceIds = (reference.workflow?.steps ?? []).filter((step) => step.kind === kind).map((step) => step.id);
    const candidateIds = (candidate.workflow?.steps ?? []).filter((step) => step.kind === kind).map((step) => step.id);
    const count = Math.min(referenceIds.length, candidateIds.length);
    for (let index = 0; index < count; index += 1) {
      idMap.set(referenceIds[index], candidateIds[index]);
    }
  }

  return idMap;
}

function remapObjectKeys(source, idMap) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return source;
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [idMap.get(key) ?? key, value]),
  );
}

function buildScenarioFixture(scenarioDir, skillPath) {
  const fixturePath = path.join(scenarioDir, "fixture.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const referencePath = path.join(scenarioDir, "reference.md");
  const idMap = buildStepIdMap(
    fs.readFileSync(referencePath, "utf8"),
    fs.readFileSync(skillPath, "utf8"),
  );

  return {
    ...fixture,
    mocks: {
      ...(fixture.mocks ?? {}),
      llm: remapObjectKeys(fixture.mocks?.llm, idMap),
      tools: remapObjectKeys(fixture.mocks?.tools, idMap),
    },
    expect: {
      ...(fixture.expect ?? {}),
      steps: remapObjectKeys(fixture.expect?.steps, idMap),
    },
  };
}

function evaluateSkillAgainstScenario(scenarioName, skillPath) {
  const scenarioDir = path.join(REPO_ROOT, "scenarios", scenarioName);
  if (!fs.existsSync(scenarioDir)) {
    throw new Error(`Scenario not found: ${scenarioDir}`);
  }

  const fixture = path.join(scenarioDir, "fixture.json");
  const budgetFile = path.join(scenarioDir, "budget.json");

  for (const required of [skillPath, fixture, budgetFile]) {
    if (!fs.existsSync(required)) {
      throw new Error(`Scenario missing required file: ${path.relative(REPO_ROOT, required)}`);
    }
  }

  const budget = JSON.parse(fs.readFileSync(budgetFile, "utf8"));
  const effectiveFixture = buildScenarioFixture(scenarioDir, skillPath);
  // Write the remapped fixture to the OS temp dir so we never dirty the repo
  // working tree (Loop B runs against scenarios/ in CI and the previous
  // "adjacent to the skill" path leaked a generated file into every run).
  const tempFixturePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "runeflow-scenario-")),
    `${path.basename(skillPath, ".md")}.fixture.json`,
  );
  fs.writeFileSync(tempFixturePath, JSON.stringify(effectiveFixture, null, 2));
  const result = {
    scenario: scenarioName,
    skill: path.relative(REPO_ROOT, skillPath),
    ok: true,
    checks: [],
    concepts: { used: [], allowed: budget.concepts, over_budget: [] },
  };

  try {
    // ─── 1. validate ────────────────────────────────────────────────────────
    const validate = spawnSync("node", [BIN, "validate", skillPath, "--format", "json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (validate.status !== 0) {
      result.ok = false;
      fail(result, "validate", {
        exit_code: validate.status,
        stdout: validate.stdout,
        stderr: validate.stderr,
      });
    } else {
      let parsed = null;
      try { parsed = JSON.parse(validate.stdout); } catch { /* no json */ }
      if (parsed && parsed.valid === false) {
        result.ok = false;
        fail(result, "validate", { issues: parsed.issues });
      } else {
        pass(result, "validate");
      }
    }

    // ─── 2. runeflow test --fixture ─────────────────────────────────────────
    const test = spawnSync(
      "node",
      [BIN, "test", skillPath, "--fixture", tempFixturePath],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    let testJson = null;
    try { testJson = JSON.parse(test.stdout); } catch { /* no json */ }
    if (test.status !== 0 || !testJson || testJson.pass !== true) {
      result.ok = false;
      fail(result, "test", {
        exit_code: test.status,
        pass: testJson?.pass,
        failures: testJson?.failures,
        stderr_tail: (test.stderr ?? "").split("\n").slice(-10).join("\n"),
      });
    } else {
      pass(result, "test");
    }

    // ─── 3. concept count ───────────────────────────────────────────────────
    const source = fs.readFileSync(skillPath, "utf8");
    const used = [...countConcepts(source)].sort();
    const allowed = new Set(budget.concepts ?? []);
    const overBudget = used.filter((c) => !allowed.has(c));
    result.concepts.used = used;
    result.concepts.over_budget = overBudget;
    if (overBudget.length > 0) {
      result.ok = false;
      fail(result, "concept_budget", { used, allowed: [...allowed], over_budget: overBudget });
    } else {
      pass(result, "concept_budget");
    }

    return result;
  } finally {
    // Clean up the temp fixture dir regardless of pass/fail. rmSync with
    // force avoids throwing if anything else already removed it.
    fs.rmSync(path.dirname(tempFixturePath), { recursive: true, force: true });
  }
}

function runScenario(scenarioName) {
  const scenarioDir = path.join(REPO_ROOT, "scenarios", scenarioName);
  if (!fs.existsSync(scenarioDir)) {
    throw new Error(`Scenario not found: ${scenarioDir}`);
  }

  const reference = path.join(scenarioDir, "reference.md");
  return evaluateSkillAgainstScenario(scenarioName, reference);
}

function printSummary(result) {
  const tag = result.ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${result.scenario}`);
  for (const check of result.checks) {
    const mark = check.ok ? "  ✓" : "  ✗";
    console.log(`${mark} ${check.name}`);
    if (!check.ok && check.detail) {
      const detail = JSON.stringify(check.detail, null, 2)
        .split("\n")
        .map((l) => `      ${l}`)
        .join("\n");
      console.log(detail);
    }
  }
  console.log("");
  console.log(`  concepts used:       ${result.concepts.used.join(", ") || "(none)"}`);
  console.log(`  concepts allowed:    ${result.concepts.allowed.join(", ")}`);
  if (result.concepts.over_budget.length > 0) {
    console.log(`  over-budget:         ${result.concepts.over_budget.join(", ")}`);
  }
  console.log("");
  console.log(JSON.stringify(result));
}

// ─── Entry ────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] === __filename;
if (isMain) {
  const scenario = process.argv[2];
  if (!scenario) {
    console.error("Usage: run-scripted.js <scenario-name>");
    process.exit(2);
  }
  const result = runScenario(scenario);
  printSummary(result);
  process.exit(result.ok ? 0 : 1);
}

export { evaluateSkillAgainstScenario, runScenario };
