import fs from "node:fs/promises";
import path from "node:path";
import { runCerebrasJsonCompletion } from "../examples/cerebras.js";
import { runAnthropicJsonCompletion } from "../examples/anthropic.js";
import { runOpenAiJsonCompletion } from "../examples/openai.js";

function normalizeFixture(fixture) {
  return {
    task_query: fixture.task_query ?? "Unknown Task",
    connection_status: fixture.connection_status ?? "ACTIVE",
    auth_link: fixture.auth_link ?? "https://rube.app/auth/mock",
  };
}

async function loadFixture(fixturePath) {
  const absolutePath = path.resolve(fixturePath);
  const source = await fs.readFile(absolutePath, "utf8");
  return normalizeFixture(JSON.parse(source));
}

function buildAddresszenMessages({ prompt, input, docs, context }) {
  const operatorNotes = docs?.trim() ? docs.trim() : "No operator notes were provided.";

  const systemPrompt = [
    "You are an AI tasked with executing Addresszen tasks via Composio.",
    "Return valid JSON only with keys 'status' and 'action_taken'.",
    "Keep it concise and factual.",
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

  return { systemPrompt, userPrompt };
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

async function handleAddresszenDraft(payload) {
  const parsed = await dispatchLlm({
    llm: payload.llm,
    ...buildAddresszenMessages(payload),
  });

  return {
    status: parsed.status || "success",
    action_taken: parsed.action_taken || "Action executed",
  };
}

export async function createRuntime(options = {}) {
  const fixture = await loadFixture(options.fixturePath ?? "eval/fixtures/addresszen-automation.default.json");

  return {
    tools: {
      "rube.manage_connections": async () => ({
        status: fixture.connection_status,
        auth_link: fixture.auth_link,
      }),
    },
    llms: {
      cerebras: handleAddresszenDraft,
      anthropic: handleAddresszenDraft,
      openai: handleAddresszenDraft,
    },
  };
}
