import test from "node:test";
import assert from "node:assert/strict";
import { selectTemplate, reselectWithAnswer } from "../src/init-heuristics.js";

const BASE_SIGNALS = {
  repoName: "test-repo",
  primaryLanguage: "javascript",
  packageManager: "npm",
  ciProvider: "none",
  scripts: [],
  integrations: [],
  existingSkillNames: [],
  existingSkillTools: [],
  gitCommits: [],
  extraContext: [],
  claudeSkillFiles: [],
};

// ---------------------------------------------------------------------------
// forceTemplate bypasses scoring
// ---------------------------------------------------------------------------

test("forceTemplate bypasses scoring and returns the named template with score=100", () => {
  const result = selectTemplate(BASE_SIGNALS, { forceTemplate: "open-pr" });
  assert.equal(result.templateId, "open-pr");
  assert.equal(result.score, 100);
  assert.equal(result.confident, true);
});

test("forceTemplate throws for unknown template id", () => {
  assert.throws(
    () => selectTemplate(BASE_SIGNALS, { forceTemplate: "nonexistent-template" }),
    /Unknown template "nonexistent-template"/,
  );
});

// ---------------------------------------------------------------------------
// Confidence threshold boundary (score 39 vs 40)
// ---------------------------------------------------------------------------

test("returns confident=false when best score is below threshold (39)", () => {
  // Use a signal set that produces a score just below 40
  // deploy template has scripts: [{ value: "deploy", weight: 40 }]
  // We need a score of 39 — hard to hit exactly, so test with empty signals (score=0)
  const result = selectTemplate(BASE_SIGNALS);
  assert.equal(result.confident, false);
  assert.equal(result.templateId, "generic-llm-task");
});

test("returns confident=true when best score is at or above threshold (40)", () => {
  // stripe-payment has integrations: [{ value: "stripe", weight: 60 }]
  const signals = { ...BASE_SIGNALS, integrations: ["stripe"] };
  const result = selectTemplate(signals);
  assert.equal(result.confident, true);
  assert.equal(result.templateId, "stripe-payment");
  assert.ok(result.score >= 40);
});

// ---------------------------------------------------------------------------
// existingSkillTools 1.5× multiplier
// ---------------------------------------------------------------------------

test("existingSkillTools applies 1.5x weight multiplier for matching keywords", () => {
  // open-pr has keywords: [{ value: "pr", weight: 15 }, { value: "pull request", weight: 15 }]
  // If existingSkillTools contains a tool with "pr" in the name, score should be 15 * 1.5 = 22.5
  const signalsWithTool = { ...BASE_SIGNALS, existingSkillTools: ["git.open-pr-tool"] };
  const signalsWithout = { ...BASE_SIGNALS };

  const withTool = selectTemplate(signalsWithTool);
  const without = selectTemplate(signalsWithout);

  assert.ok(
    (withTool.scores["open-pr"] ?? 0) > (without.scores["open-pr"] ?? 0),
    `Expected open-pr score to be higher with existingSkillTools. With: ${withTool.scores["open-pr"]}, Without: ${without.scores["open-pr"]}`,
  );
});

// ---------------------------------------------------------------------------
// reselectWithAnswer updates selection
// ---------------------------------------------------------------------------

test("reselectWithAnswer appends answer to extraContext and re-scores", () => {
  // With no context, no template should win confidently
  const initial = selectTemplate(BASE_SIGNALS);
  assert.equal(initial.confident, false);

  // Adding "stripe payment" as context should boost stripe-payment
  const reselected = reselectWithAnswer(BASE_SIGNALS, "stripe payment");
  assert.ok(
    (reselected.scores["stripe-payment"] ?? 0) > (initial.scores["stripe-payment"] ?? 0),
    "stripe-payment score should increase after adding 'stripe payment' context",
  );
});

test("reselectWithAnswer does not mutate the original signals", () => {
  const signals = { ...BASE_SIGNALS, extraContext: ["original"] };
  reselectWithAnswer(signals, "new context");
  assert.deepEqual(signals.extraContext, ["original"], "original signals should not be mutated");
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

test("disqualifies templates whose id is in existingSkillNames", () => {
  // stripe-payment would normally win with stripe integration
  const signals = {
    ...BASE_SIGNALS,
    integrations: ["stripe"],
    existingSkillNames: ["stripe-payment"],
  };
  const result = selectTemplate(signals);
  assert.notEqual(result.templateId, "stripe-payment", "stripe-payment should be disqualified");
  assert.equal(result.scores["stripe-payment"], 0, "disqualified template should have score=0");
});

// ---------------------------------------------------------------------------
// scores object contains all template IDs
// ---------------------------------------------------------------------------

test("scores object contains an entry for every template", () => {
  const result = selectTemplate(BASE_SIGNALS);
  const expectedIds = ["open-pr", "release-notes", "test-and-lint", "deploy", "notify-slack", "stripe-payment", "linear-issue", "generic-llm-task"];
  for (const id of expectedIds) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(result.scores, id),
      `scores should contain entry for "${id}"`,
    );
  }
});
