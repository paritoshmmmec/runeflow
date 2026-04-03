import { runCerebrasJsonCompletion } from "./cerebras.js";
import { runAnthropicJsonCompletion } from "./anthropic.js";

function buildMessages({ prompt, input, docs, context }) {
  const operatorNotes = docs?.trim()
    ? docs.trim()
    : "No operator notes were provided.";

  const systemPrompt = [
    "You are drafting high-level code review notes for a repository diff.",
    "You are not responsible for enforcing Runeflow execution semantics.",
    "Return JSON only with keys 'summary', 'risks', and 'test_focus'.",
    "Keep the summary concise, list only actionable risks, and keep test_focus practical.",
    "If the diff appears low risk, return an empty risks array or a clearly low-risk summary.",
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

async function handleReview({ llm, prompt, input, docs, context }) {
  const parsed = await dispatchLlm({
    llm,
    ...buildMessages({ prompt, input, docs, context }),
  });

  if (
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.risks) ||
    !Array.isArray(parsed.test_focus) ||
    !parsed.risks.every((item) => typeof item === "string") ||
    !parsed.test_focus.every((item) => typeof item === "string")
  ) {
    throw new Error("LLM JSON response must include summary:string, risks:string[], and test_focus:string[].");
  }

  return {
    summary: parsed.summary,
    risks: parsed.risks,
    test_focus: parsed.test_focus,
  };
}

export const llms = {
  cerebras: handleReview,
  anthropic: handleReview,
};
