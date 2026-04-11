import { templates } from "./init-templates/index.js";

const CONFIDENCE_THRESHOLD = 40;
const FALLBACK_ID = "generic-llm-task";

/**
 * Score all templates against the given signals.
 * @param {object} signals
 * @returns {Record<string, number>}
 */
function scoreAll(signals) {
  const gitText = (signals.gitCommits ?? []).join(" ").toLowerCase();
  const extraText = (signals.extraContext ?? []).join(" ").toLowerCase();
  const skillText = (signals.existingSkillNames ?? []).join(" ").toLowerCase();
  const existingSkillTools = signals.existingSkillTools ?? [];
  const existingSkillNames = signals.existingSkillNames ?? [];

  const scores = {};

  for (const tmpl of templates) {
    const desc = tmpl.signals ?? {};

    // Disqualify templates whose id matches an existing skill name
    if (existingSkillNames.includes(tmpl.id)) {
      scores[tmpl.id] = 0;
      continue;
    }

    let score = 0;

    // 1. integrations
    for (const { value, weight } of desc.integrations ?? []) {
      if ((signals.integrations ?? []).includes(value)) {
        score += weight;
      }
    }

    // 2. scripts
    for (const { value, weight } of desc.scripts ?? []) {
      if ((signals.scripts ?? []).includes(value)) {
        score += weight;
      }
    }

    // 3. keywords — check gitCommits, extraContext, existingSkillNames
    for (const { value, weight } of desc.keywords ?? []) {
      const v = value.toLowerCase();
      if (gitText.includes(v) || extraText.includes(v) || skillText.includes(v)) {
        score += weight;
      }
    }

    // 4. existingSkillTools — 1.5× multiplier when a tool name contains a signal value
    const allSignalValues = [
      ...(desc.integrations ?? []).map((e) => ({ value: e.value.toLowerCase(), weight: e.weight })),
      ...(desc.keywords ?? []).map((e) => ({ value: e.value.toLowerCase(), weight: e.weight })),
    ];

    for (const toolName of existingSkillTools) {
      const toolLower = toolName.toLowerCase();
      for (const { value, weight } of allSignalValues) {
        if (toolLower.includes(value)) {
          score += weight * 1.5;
        }
      }
    }

    scores[tmpl.id] = score;
  }

  return scores;
}

/**
 * Select the best-fit template for the given signals.
 *
 * @param {object} signals
 * @param {object} [options]
 * @param {string} [options.forceTemplate]  - bypass scoring, use named template
 * @returns {{ templateId: string, score: number, confident: boolean, scores: Record<string, number> }}
 */
export function selectTemplate(signals, options = {}) {
  const { forceTemplate } = options;

  const scores = scoreAll(signals);

  if (forceTemplate) {
    const found = templates.find((t) => t.id === forceTemplate);
    if (!found) {
      const ids = templates.map((t) => t.id).join(", ");
      throw new Error(
        `Unknown template "${forceTemplate}". Valid template IDs: ${ids}`,
      );
    }
    return { templateId: forceTemplate, score: 100, confident: true, scores };
  }

  // Find highest scoring template
  let bestId = null;
  let bestScore = -Infinity;
  for (const [id, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  // Fall back to generic-llm-task when nothing scores above threshold
  if (bestScore < CONFIDENCE_THRESHOLD) {
    return {
      templateId: FALLBACK_ID,
      score: bestScore < 0 ? 0 : bestScore,
      confident: false,
      scores,
    };
  }

  return {
    templateId: bestId,
    score: bestScore,
    confident: bestScore >= CONFIDENCE_THRESHOLD,
    scores,
  };
}

/**
 * Re-score templates using the user's clarifying question answer as an additional signal.
 *
 * @param {object} signals
 * @param {string} answer  - user's clarifying question answer
 * @returns {{ templateId: string, score: number, confident: boolean, scores: Record<string, number> }}
 */
export function reselectWithAnswer(signals, answer) {
  const updated = {
    ...signals,
    extraContext: [...(signals.extraContext ?? []), answer],
  };
  return selectTemplate(updated);
}
