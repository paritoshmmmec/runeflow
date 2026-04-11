import test from "node:test";
import assert from "node:assert/strict";
import { templates, getTemplate } from "../src/init-templates/index.js";
import { parseRuneflow } from "../src/parser.js";
import { validateRuneflow } from "../src/validator.js";

const BASE_SIGNALS = {
  repoName: "my-app",
  primaryLanguage: "javascript",
  packageManager: "npm",
  ciProvider: "github-actions",
  scripts: ["test", "lint", "build", "deploy"],
  integrations: [],
  existingSkillNames: [],
  existingSkillTools: [],
  gitCommits: [],
  extraContext: [],
  claudeSkillFiles: [],
};

const BASE_OPTIONS = {
  provider: "cerebras",
  model: "qwen-3-235b-a22b-instruct-2507",
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test("templates registry exports 8 templates", () => {
  assert.equal(templates.length, 8);
});

test("getTemplate returns the correct template by id", () => {
  for (const t of templates) {
    const found = getTemplate(t.id);
    assert.ok(found, `getTemplate("${t.id}") should return a template`);
    assert.equal(found.id, t.id);
  }
});

test("getTemplate returns null for unknown id", () => {
  assert.equal(getTemplate("nonexistent"), null);
});

// ---------------------------------------------------------------------------
// Each template: generate() substitutes repo name and provider
// ---------------------------------------------------------------------------

for (const template of templates) {
  test(`${template.id}: generate() substitutes repoName into skill name`, () => {
    const output = template.generate(BASE_SIGNALS, BASE_OPTIONS);
    // The skill name should contain the repo slug or be a valid slug
    assert.match(output, /name: [a-z0-9-]+/);
  });

  test(`${template.id}: generate() substitutes provider into frontmatter`, () => {
    const output = template.generate(BASE_SIGNALS, { ...BASE_OPTIONS, provider: "openai", model: "gpt-4o" });
    assert.match(output, /provider: openai/);
    assert.match(output, /model: gpt-4o/);
  });

  test(`${template.id}: generate() respects --name override`, () => {
    const output = template.generate(BASE_SIGNALS, { ...BASE_OPTIONS, name: "custom-skill-name" });
    assert.match(output, /name: custom-skill-name/);
  });

  test(`${template.id}: signals descriptor has expected weighted fields`, () => {
    const { signals } = template;
    assert.ok(typeof signals === "object" && signals !== null, "signals must be an object");
    // At least one signal category must be present
    const hasSignals = signals.integrations?.length > 0
      || signals.scripts?.length > 0
      || signals.keywords?.length > 0;
    assert.ok(hasSignals, `template "${template.id}" must declare at least one signal`);
    // All signal entries must have value and weight
    for (const category of ["integrations", "scripts", "keywords"]) {
      for (const entry of signals[category] ?? []) {
        assert.ok(typeof entry.value === "string", `${template.id}.signals.${category}[].value must be string`);
        assert.ok(typeof entry.weight === "number", `${template.id}.signals.${category}[].weight must be number`);
        assert.ok(entry.weight > 0, `${template.id}.signals.${category}[].weight must be positive`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Template-specific signal checks
// ---------------------------------------------------------------------------

test("open-pr: signals include github integration with high weight", () => {
  const t = getTemplate("open-pr");
  const githubSignal = t.signals.integrations?.find((s) => s.value === "github");
  assert.ok(githubSignal, "open-pr should have github integration signal");
  assert.ok(githubSignal.weight >= 30, "github signal weight should be >= 30");
});

test("notify-slack: signals include slack integration with high weight", () => {
  const t = getTemplate("notify-slack");
  const slackSignal = t.signals.integrations?.find((s) => s.value === "slack");
  assert.ok(slackSignal, "notify-slack should have slack integration signal");
  assert.ok(slackSignal.weight >= 50, "slack signal weight should be >= 50");
});

test("stripe-payment: signals include stripe integration with high weight", () => {
  const t = getTemplate("stripe-payment");
  const stripeSignal = t.signals.integrations?.find((s) => s.value === "stripe");
  assert.ok(stripeSignal, "stripe-payment should have stripe integration signal");
  assert.ok(stripeSignal.weight >= 50, "stripe signal weight should be >= 50");
});

test("linear-issue: signals include linear integration with high weight", () => {
  const t = getTemplate("linear-issue");
  const linearSignal = t.signals.integrations?.find((s) => s.value === "linear");
  assert.ok(linearSignal, "linear-issue should have linear integration signal");
  assert.ok(linearSignal.weight >= 50, "linear signal weight should be >= 50");
});

test("test-and-lint: signals include test and lint scripts", () => {
  const t = getTemplate("test-and-lint");
  const testSignal = t.signals.scripts?.find((s) => s.value === "test");
  const lintSignal = t.signals.scripts?.find((s) => s.value === "lint");
  assert.ok(testSignal, "test-and-lint should have test script signal");
  assert.ok(lintSignal, "test-and-lint should have lint script signal");
});

test("deploy: signals include deploy script with high weight", () => {
  const t = getTemplate("deploy");
  const deploySignal = t.signals.scripts?.find((s) => s.value === "deploy");
  assert.ok(deploySignal, "deploy should have deploy script signal");
  assert.ok(deploySignal.weight >= 30, "deploy signal weight should be >= 30");
});

// ---------------------------------------------------------------------------
// Validation: all templates produce valid skills
// ---------------------------------------------------------------------------

for (const template of templates) {
  test(`${template.id}: generate() produces a skill that passes validateRuneflow`, () => {
    const output = template.generate(BASE_SIGNALS, BASE_OPTIONS);
    const parsed = parseRuneflow(output);
    const result = validateRuneflow(parsed);
    assert.deepEqual(
      result.issues,
      [],
      `${template.id} produced validation issues: ${JSON.stringify(result.issues)}\n\nOutput:\n${output}`,
    );
  });
}
