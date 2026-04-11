// Feature: smarter-init, Property 8: Generated skill always passes validation

import test from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import { templates } from "../src/init-templates/index.js";
import { parseRuneflow } from "../src/parser.js";
import { validateRuneflow } from "../src/validator.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const signalSetArb = fc.record({
  repoName: fc.constantFrom("my-app", "test-repo", "my-project", "webapp"),
  primaryLanguage: fc.constantFrom("javascript", "typescript", "python", "unknown"),
  packageManager: fc.constantFrom("npm", "yarn", "pnpm", "none"),
  ciProvider: fc.constantFrom("github-actions", "travis", "none"),
  scripts: fc.array(
    fc.constantFrom("test", "lint", "build", "deploy", "push", "release"),
    { maxLength: 5 },
  ),
  integrations: fc.array(
    fc.constantFrom("stripe", "slack", "linear", "github", "notion"),
    { maxLength: 3 },
  ),
  existingSkillNames: fc.constant([]),
  existingSkillTools: fc.constant([]),
  gitCommits: fc.array(fc.string({ maxLength: 50 }), { maxLength: 5 }),
  extraContext: fc.constant([]),
  claudeSkillFiles: fc.constant([]),
});

const optionsArb = fc.record({
  provider: fc.constantFrom("cerebras", "openai", "anthropic"),
  model: fc.constantFrom(
    "qwen-3-235b-a22b-instruct-2507",
    "gpt-4o",
    "claude-3-7-sonnet-latest",
  ),
  name: fc.option(
    fc.constantFrom("my-skill", "test-skill", "custom-skill"),
    { nil: undefined },
  ),
});

// ---------------------------------------------------------------------------
// Property 8: Generated skill always passes validation
// Validates: Requirements 4.2, 4.3, 4.4
// ---------------------------------------------------------------------------

for (const template of templates) {
  test(`Property 8: template "${template.id}" — generate() always produces a skill that passes validateRuneflow`, () => {
    fc.assert(
      fc.property(signalSetArb, optionsArb, (signals, options) => {
        const source = template.generate(signals, options);

        assert.equal(typeof source, "string", "generate() must return a string");
        assert.ok(source.length > 0, "generate() must return a non-empty string");

        const parsed = parseRuneflow(source);
        const result = validateRuneflow(parsed);

        assert.deepEqual(
          result.issues,
          [],
          `template "${template.id}" produced validation issues:\n${result.issues.join("\n")}\n\nGenerated source:\n${source}`,
        );
      }),
      { numRuns: 100 },
    );
  });
}
