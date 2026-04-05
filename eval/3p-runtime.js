import fs from "node:fs/promises";
import path from "node:path";
import { runCerebrasJsonCompletion } from "../examples/cerebras.js";
import { runAnthropicJsonCompletion } from "../examples/anthropic.js";
import { runOpenAiJsonCompletion } from "../examples/openai.js";

function normalizeFixture(fixture) {
  return {
    team_name: fixture.team_name ?? "Unknown Team",
    period_label: fixture.period_label ?? "Unknown Period",
    sources: {
      slack: fixture.sources?.slack ?? [],
      gdrive: fixture.sources?.gdrive ?? [],
      email: fixture.sources?.email ?? [],
      calendar: fixture.sources?.calendar ?? [],
    },
  };
}

async function loadFixture(fixturePath) {
  const absolutePath = path.resolve(fixturePath);
  const source = await fs.readFile(absolutePath, "utf8");
  return normalizeFixture(JSON.parse(source));
}

function build3pMessages({ prompt, input, docs, context }) {
  const operatorNotes = docs?.trim() ? docs.trim() : "No operator notes were provided.";

  const systemPrompt = [
    "You are writing a concise 3P update: Progress, Plans, Problems.",
    "Return valid JSON only with keys 'emoji', 'progress', 'plans', 'problems', and 'formatted'.",
    "Keep each section concise, factual, and readable in 30-60 seconds.",
    "The 'formatted' field must be plain text with exactly four lines and no markdown bullets or emphasis:",
    "[emoji] [Team Name] ([Dates Covered])",
    "Progress: ...",
    "Plans: ...",
    "Problems: ...",
    "Do not include any extra lines before or after those four lines.",
    "Do not repeat metadata, notes, or explanations inside the formatted field.",
    `Runeflow metadata: ${context.metadata.name}@${context.metadata.version}`,
  ].join("\n");

  const userPrompt = [
    prompt,
    "",
    "Projected operator notes:",
    operatorNotes,
    "",
    "Resolved workflow input:",
    JSON.stringify(input, null, 2),
  ].join("\n");

  return {
    systemPrompt,
    userPrompt,
  };
}

async function dispatchLlm({ llm, systemPrompt, userPrompt }) {
  switch (llm.provider) {
    case "cerebras":
      return runCerebrasJsonCompletion({ systemPrompt, userPrompt, llm });
    case "anthropic":
      return runAnthropicJsonCompletion({ systemPrompt, userPrompt, llm });
    case "openai":
      return runOpenAiJsonCompletion({ systemPrompt, userPrompt, llm });
    default:
      throw new Error(`Unsupported LLM provider '${llm.provider}'.`);
  }
}

async function handle3pDraft(payload) {
  const parsed = await dispatchLlm({
    llm: payload.llm,
    ...build3pMessages(payload),
  });

  if (
    typeof parsed.emoji !== "string"
    || typeof parsed.progress !== "string"
    || typeof parsed.plans !== "string"
    || typeof parsed.problems !== "string"
    || typeof parsed.formatted !== "string"
  ) {
    throw new Error("3P response must include emoji, progress, plans, problems, and formatted as strings.");
  }

  return {
    emoji: parsed.emoji,
    progress: parsed.progress.trim(),
    plans: parsed.plans.trim(),
    problems: parsed.problems.trim(),
    formatted: parsed.formatted.trim(),
  };
}

export async function createRuntime(options = {}) {
  const fixture = await loadFixture(options.fixturePath ?? "eval/fixtures/3p-updates.default.json");

  return {
    tools: {
      "slack.collect_team_updates": async () => ({
        highlights: fixture.sources.slack,
      }),
      "gdrive.collect_team_docs": async () => ({
        highlights: fixture.sources.gdrive,
      }),
      "email.collect_team_threads": async () => ({
        highlights: fixture.sources.email,
      }),
      "calendar.collect_team_events": async () => ({
        highlights: fixture.sources.calendar,
      }),
    },
    llms: {
      cerebras: handle3pDraft,
      anthropic: handle3pDraft,
      openai: handle3pDraft,
    },
  };
}
