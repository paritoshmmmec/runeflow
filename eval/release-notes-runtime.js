import fs from "node:fs/promises";
import path from "node:path";
import { runCerebrasJsonCompletion } from "../examples/cerebras.js";
import { runOpenAiJsonCompletion } from "../examples/openai.js";

function normalizeFixture(fixture) {
  return {
    base_ref: fixture.base_ref ?? "v0.1.0",
    branch: fixture.branch ?? "main",
    diff_summary: fixture.diff_summary ?? "No changes.",
    files: fixture.files ?? [],
  };
}

async function loadFixture(fixturePath) {
  const absolutePath = path.resolve(fixturePath);
  const source = await fs.readFile(absolutePath, "utf8");
  return normalizeFixture(JSON.parse(source));
}

function buildMessages({ prompt, input, docs }) {
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

  return { systemPrompt, userPrompt };
}

async function dispatchLlm({ llm, systemPrompt, userPrompt }) {
  switch (llm.provider) {
    case "cerebras":
      return runCerebrasJsonCompletion({ systemPrompt, userPrompt, llm });
    case "openai":
      return runOpenAiJsonCompletion({ systemPrompt, userPrompt, llm });
    default:
      throw new Error(`Unsupported LLM provider '${llm.provider}'.`);
  }
}

async function handleDraft(payload) {
  const parsed = await dispatchLlm({
    llm: payload.llm,
    ...buildMessages(payload),
  });

  return {
    title: parsed.title ?? "",
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
    breaking_changes: Array.isArray(parsed.breaking_changes) ? parsed.breaking_changes : [],
    full_notes: parsed.full_notes ?? "",
  };
}

export async function createRuntime(options = {}) {
  const fixture = await loadFixture(options.fixturePath ?? "eval/fixtures/release-notes.default.json");

  return {
    tools: {
      // Override git builtins with fixture data so eval runs without a real git repo
      "git.current_branch": async () => ({ branch: fixture.branch }),
      "git.diff_summary": async () => ({
        base: fixture.base_ref,
        summary: fixture.diff_summary,
        files: fixture.files,
      }),
    },
    llms: {
      cerebras: handleDraft,
      openai: handleDraft,
    },
  };
}
