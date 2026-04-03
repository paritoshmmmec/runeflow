const DEFAULT_CEREBRAS_API_BASE = "https://api.cerebras.ai/v1";
const DEFAULT_CEREBRAS_MODEL = "qwen-3-235b-a22b-instruct-2507";
const FALLBACK_CEREBRAS_MODELS = [
  "qwen-3-235b-a22b-instruct-2507",
  "llama3.1-8b",
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable '${name}'.`);
  }
  return value;
}

function parseJsonResponse(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Cerebras response was not valid JSON: ${error.message}`);
  }
}

export async function runCerebrasJsonCompletion({ systemPrompt, userPrompt }) {
  const apiKey = requireEnv("CEREBRAS_API_KEY");
  const baseUrl = process.env.CEREBRAS_API_BASE ?? DEFAULT_CEREBRAS_API_BASE;
  const configuredModel = process.env.CEREBRAS_MODEL ?? DEFAULT_CEREBRAS_MODEL;
  const candidateModels = [
    configuredModel,
    ...FALLBACK_CEREBRAS_MODELS.filter((model) => model !== configuredModel),
  ];

  let payload = null;
  let lastErrorMessage = null;

  for (const model of candidateModels) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (response.ok) {
      payload = await response.json();
      break;
    }

    const errorBody = await response.text();
    lastErrorMessage = `Cerebras API request failed for model '${model}' (${response.status}): ${errorBody}`;

    const parsedError = (() => {
      try {
        return JSON.parse(errorBody);
      } catch {
        return null;
      }
    })();

    if (response.status !== 404 || parsedError?.code !== "model_not_found") {
      throw new Error(lastErrorMessage);
    }
  }

  if (!payload) {
    throw new Error(lastErrorMessage ?? "Cerebras API request failed for all candidate models.");
  }

  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Cerebras API returned an empty completion.");
  }

  return parseJsonResponse(content);
}
