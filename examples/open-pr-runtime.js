import { runCerebrasJsonCompletion } from "./cerebras.js";
import { runAnthropicJsonCompletion } from "./anthropic.js";

function buildMessages({ prompt, input, docs, context }) {
  const operatorNotes = docs?.trim()
    ? docs.trim()
    : "No operator notes were provided.";

  const systemPrompt = [
    "You are preparing a pull request draft for a local repository workflow.",
    "You are not responsible for enforcing Runeflow execution semantics.",
    "Return JSON only with keys 'title' and 'body'.",
    "Keep the title concise and make the body useful to a human reviewer.",
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
    default:
      throw new Error(`Unsupported LLM provider '${llm.provider}'.`);
  }
}

async function handleDraft({ llm, prompt, input, docs, context }) {
  const parsed = await dispatchLlm({
    llm,
    ...buildMessages({ prompt, input, docs, context }),
  });

  if (typeof parsed.title !== "string" || typeof parsed.body !== "string") {
    throw new Error("LLM JSON response must include string fields 'title' and 'body'.");
  }

  return {
    title: parsed.title,
    body: parsed.body,
  };
}

export const llms = {
  cerebras: handleDraft,
  anthropic: handleDraft,
};
