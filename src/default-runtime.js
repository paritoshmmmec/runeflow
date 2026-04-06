/**
 * Default Runeflow runtime.
 *
 * Supports cerebras, openai, and anthropic out of the box.
 * Provider is read from the skill's `llm.provider` field.
 * API keys are read from environment variables:
 *
 *   CEREBRAS_API_KEY   → provider: cerebras
 *   OPENAI_API_KEY     → provider: openai
 *   ANTHROPIC_API_KEY  → provider: anthropic
 *
 * Usage:
 *   import { createDefaultRuntime } from "runeflow";
 *   const runtime = createDefaultRuntime();
 *   await runRuneflow(definition, inputs, runtime, options);
 *
 * Or via CLI:
 *   runeflow run skill.runeflow.md --input '{}' --runtime node_modules/runeflow/src/default-runtime.js
 */

// ─── Provider configs ────────────────────────────────────────────────────────

const PROVIDERS = {
  cerebras: {
    envKey: "CEREBRAS_API_KEY",
    baseUrlEnv: "CEREBRAS_API_BASE",
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "qwen-3-235b-a22b-instruct-2507",
    modelEnv: "CEREBRAS_MODEL",
    endpoint: "/chat/completions",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    buildBody: (model, messages) => ({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages,
    }),
    extractContent: (payload) => payload?.choices?.[0]?.message?.content,
  },
  openai: {
    envKey: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_API_BASE",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    modelEnv: "OPENAI_MODEL",
    endpoint: "/chat/completions",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    buildBody: (model, messages) => ({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages,
    }),
    extractContent: (payload) => payload?.choices?.[0]?.message?.content,
  },
  anthropic: {
    envKey: "ANTHROPIC_API_KEY",
    baseUrlEnv: "ANTHROPIC_API_BASE",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-7-sonnet-latest",
    modelEnv: "ANTHROPIC_MODEL",
    endpoint: "/messages",
    authHeader: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
    buildBody: (model, messages) => ({
      model,
      max_tokens: 2048,
      temperature: 0.2,
      // Anthropic uses system as a top-level field, not a message role
      system: messages.find((m) => m.role === "system")?.content ?? "",
      messages: messages.filter((m) => m.role !== "system"),
    }),
    extractContent: (payload) => payload?.content?.find((b) => b.type === "text")?.text,
  },
};

// ─── Core fetch ──────────────────────────────────────────────────────────────

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable '${name}'. Add it to your .env file or export it in your shell.`,
    );
  }
  return value;
}

function parseJson(text, providerName) {
  // Strip markdown fences if the model wrapped the JSON anyway
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    throw new Error(`${providerName} returned non-JSON content: ${text.slice(0, 200)}`);
  }
}

async function callProvider(providerName, config, model, messages) {
  const apiKey = getEnv(config.envKey);
  const baseUrl = process.env[config.baseUrlEnv] ?? config.defaultBaseUrl;
  const url = `${baseUrl}${config.endpoint}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...config.authHeader(apiKey),
    },
    body: JSON.stringify(config.buildBody(model, messages)),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${providerName} API error (${response.status}): ${text.slice(0, 400)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${providerName} returned non-JSON response: ${text.slice(0, 200)}`);
  }

  const content = config.extractContent(payload);
  if (!content?.trim()) {
    throw new Error(`${providerName} returned an empty completion.`);
  }

  return parseJson(content, providerName);
}

// ─── Message builder ─────────────────────────────────────────────────────────

function buildMessages({ prompt, input, docs, schema }) {
  const schemaHint = schema
    ? `Respond with a JSON object matching this schema:\n${JSON.stringify(schema, null, 2)}\nOutput only the JSON object — no markdown fences, no explanation.`
    : "Respond with a JSON object. Output only the JSON — no markdown fences, no explanation.";

  const systemContent = [
    docs?.trim() ?? "",
    "",
    schemaHint,
  ].filter(Boolean).join("\n").trim();

  const userContent = [
    prompt,
    input && Object.keys(input).length > 0
      ? `\nResolved input:\n${JSON.stringify(input, null, 2)}`
      : "",
  ].join("").trim();

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

// ─── Handler factory ─────────────────────────────────────────────────────────

function makeHandler(providerName) {
  return async ({ llm, prompt, input, docs, schema }) => {
    const config = PROVIDERS[providerName];
    const model = llm?.model ?? process.env[config.modelEnv] ?? config.defaultModel;
    const messages = buildMessages({ prompt, input, docs, schema });
    return callProvider(providerName, config, model, messages);
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a default runtime that handles cerebras, openai, and anthropic.
 * Pass it directly to runRuneflow().
 *
 * @returns {{ llms: Record<string, Function> }}
 */
export function createDefaultRuntime() {
  return {
    llms: {
      cerebras: makeHandler("cerebras"),
      openai: makeHandler("openai"),
      anthropic: makeHandler("anthropic"),
    },
  };
}

// Default export for --runtime flag usage
export default createDefaultRuntime();
