const DEFAULT_OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o";
const FALLBACK_OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-3.5-turbo-0125",
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
    throw new Error(`OpenAI response was not valid JSON: ${error.message}`);
  }
}

export async function runOpenAiJsonCompletion({ systemPrompt, userPrompt, llm = {} }) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseUrl = process.env.OPENAI_API_BASE ?? DEFAULT_OPENAI_API_BASE;
  const configuredModel = llm.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const candidateModels = [
    configuredModel,
    ...FALLBACK_OPENAI_MODELS.filter((model) => model !== configuredModel),
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
        temperature: 0,
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
    lastErrorMessage = `OpenAI API request failed for model '${model}' (${response.status}): ${errorBody}`;

    const parsedError = (() => {
      try {
        return JSON.parse(errorBody);
      } catch {
        return null;
      }
    })();

    // Only retry on certain errors (e.g., model not found)
    if (response.status !== 404) {
      throw new Error(lastErrorMessage);
    }
  }

  if (!payload) {
    throw new Error(lastErrorMessage ?? "OpenAI API request failed for all candidate models.");
  }

  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI API returned an empty completion.");
  }

  return parseJsonResponse(content);
}
