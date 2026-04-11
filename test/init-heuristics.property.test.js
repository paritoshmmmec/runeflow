// Feature: smarter-init, Property 6: Template selection is consistent with scoring
// Feature: smarter-init, Property 7: Deduplication — selected template does not duplicate existing skills
// Feature: smarter-init, Property 12: --context flag influences template selection

import test from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import { selectTemplate } from "../src/init-heuristics.js";
import { templates } from "../src/init-templates/index.js";

const CONFIDENCE_THRESHOLD = 40;
const FALLBACK_ID = "generic-llm-task";

const templateIds = templates.map((t) => t.id);

const baseSignals = {
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
// Helpers
// ---------------------------------------------------------------------------

function argmax(scores) {
  let bestId = null;
  let bestScore = -Infinity;
  for (const [id, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return { bestId, bestScore };
}

// ---------------------------------------------------------------------------
// Property 6: Template selection is consistent with scoring
// Validates: Requirements 2.2, 2.3
// ---------------------------------------------------------------------------

test("Property 6: selected templateId matches argmax of scores (or fallback when all below threshold)", () => {
  fc.assert(
    fc.property(
      fc.record({
        integrations: fc.subarray(
          ["stripe", "slack", "linear", "github", "notion", "supabase"],
          { maxLength: 3 },
        ),
        scripts: fc.subarray(
          ["test", "lint", "build", "deploy", "push", "release"],
          { maxLength: 4 },
        ),
      }),
      ({ integrations, scripts }) => {
        const signals = { ...baseSignals, integrations, scripts };
        const selection = selectTemplate(signals);
        const { bestId, bestScore } = argmax(selection.scores);

        if (bestScore < CONFIDENCE_THRESHOLD) {
          assert.equal(
            selection.templateId,
            FALLBACK_ID,
            `Expected fallback "${FALLBACK_ID}" when all scores < ${CONFIDENCE_THRESHOLD}, got "${selection.templateId}" (bestScore=${bestScore})`,
          );
        } else {
          assert.equal(
            selection.templateId,
            bestId,
            `Expected templateId="${bestId}" (score=${bestScore}) but got "${selection.templateId}" (score=${selection.scores[selection.templateId]})`,
          );
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 7: Deduplication — selected template does not duplicate existing skills
// Validates: Requirements 2.6
// ---------------------------------------------------------------------------

const deduplicableTemplateIds = templateIds.filter((id) => id !== FALLBACK_ID);

test("Property 7: selectTemplate never returns a non-fallback templateId that is in existingSkillNames", () => {
  fc.assert(
    fc.property(
      fc.subarray(deduplicableTemplateIds, { minLength: 1, maxLength: 4 }),
      (existingSkillNames) => {
        const signals = { ...baseSignals, existingSkillNames };
        const selection = selectTemplate(signals);

        assert.ok(
          !existingSkillNames.includes(selection.templateId),
          `selectTemplate returned "${selection.templateId}" which is in existingSkillNames: [${existingSkillNames.join(", ")}]`,
        );
      },
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 12: --context flag influences template selection
// Validates: Requirements 8.1, 3.2
// ---------------------------------------------------------------------------

const keywordEntries = templates
  .filter((t) => t.id !== FALLBACK_ID)
  .flatMap((t) =>
    (t.signals.keywords ?? []).map((kw) => ({ templateId: t.id, keyword: kw.value })),
  );

test("Property 12: adding a template keyword to extraContext increases that template's score", () => {
  assert.ok(keywordEntries.length > 0, "Expected at least one keyword entry across templates");

  fc.assert(
    fc.property(
      fc.constantFrom(...keywordEntries),
      ({ templateId, keyword }) => {
        const signalsWithout = { ...baseSignals, extraContext: [] };
        const signalsWith = { ...baseSignals, extraContext: [keyword] };

        const selectionWithout = selectTemplate(signalsWithout);
        const selectionWith = selectTemplate(signalsWith);

        const scoreWithout = selectionWithout.scores[templateId] ?? 0;
        const scoreWith = selectionWith.scores[templateId] ?? 0;

        assert.ok(
          scoreWith >= scoreWithout,
          `Score for "${templateId}" should be >= without context when keyword "${keyword}" is added. ` +
            `scoreWithout=${scoreWithout}, scoreWith=${scoreWith}`,
        );
      },
    ),
    { numRuns: 100 },
  );
});
