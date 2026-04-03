import { runCerebrasJsonCompletion } from "./cerebras.js";

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

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

export async function llm({ prompt, input, docs, context }) {
  const parsed = await runCerebrasJsonCompletion(buildMessages({ prompt, input, docs, context }));

  if (typeof parsed.title !== "string" || typeof parsed.body !== "string") {
    throw new Error("Cerebras API JSON response must include string fields 'title' and 'body'.");
  }

  return {
    title: parsed.title,
    body: parsed.body,
  };
}
