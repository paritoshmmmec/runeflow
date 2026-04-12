/**
 * Runtime for release-notes.md
 *
 * Requires: CEREBRAS_API_KEY in environment (or .env file)
 *
 * Usage:
 *   node --env-file=.env ./bin/runeflow.js run ./examples/release-notes.md \
 *     --input '{"base_ref":"main"}' \
 *     --runtime ./examples/release-notes-runtime.js
 */

import { runCerebrasJsonCompletion } from "./cerebras.js";

async function handleReleaseNotesDraft({ llm, prompt, input, docs }) {
  const systemPrompt = [
    docs?.trim() ?? "Draft structured release notes.",
    "",
    "Return valid JSON only with keys: title (string), highlights (array of strings),",
    "breaking_changes (array of strings), full_notes (string).",
    "Be concise — one sentence per item. Skip merge commits and version bumps.",
  ].join("\n");

  const userPrompt = [
    prompt,
    "",
    "Resolved input:",
    JSON.stringify(input, null, 2),
  ].join("\n");

  const parsed = await runCerebrasJsonCompletion({ systemPrompt, userPrompt, llm });

  return {
    title: parsed.title ?? "",
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
    breaking_changes: Array.isArray(parsed.breaking_changes) ? parsed.breaking_changes : [],
    full_notes: parsed.full_notes ?? "",
  };
}

export default {
  llms: {
    cerebras: handleReleaseNotesDraft,
  },
};
