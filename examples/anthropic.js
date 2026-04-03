const DEFAULT_ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_MODEL = "claude-3-7-sonnet-latest";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable '${name}'.`);
  }
  return value;
}

export async function runAnthropicJsonCompletion({ systemPrompt, userPrompt, llm = {} }) {
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const baseUrl = process.env.ANTHROPIC_API_BASE ?? DEFAULT_ANTHROPIC_API_BASE;
  const model = llm.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;

  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.2,
      system: `${systemPrompt}\nReturn valid JSON only.`,
      messages: [
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic API request failed (${response.status}): ${responseText}`);
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Anthropic response was not valid JSON: ${error.message}`);
  }

  const textBlock = payload?.content?.find((item) => item.type === "text");
  if (!textBlock?.text?.trim()) {
    throw new Error("Anthropic API returned an empty completion.");
  }

  try {
    return JSON.parse(textBlock.text);
  } catch (error) {
    throw new Error(`Anthropic completion was not valid JSON: ${error.message}`);
  }
}
