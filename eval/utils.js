import { encoding_for_model, get_encoding } from "tiktoken";

function serializeForEstimation(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

const encoderCache = new Map();
let cleanupRegistered = false;
const JSON_SCHEMA_KEYS = new Set(["type", "properties", "items", "required", "additionalProperties", "description"]);

function normalizeModelName(model) {
  if (typeof model !== "string") {
    return null;
  }

  const value = model.toLowerCase();

  if (value.startsWith("gpt-4") || value.startsWith("gpt-5") || value.startsWith("o1") || value.startsWith("o3") || value.startsWith("o4")) {
    return model;
  }

  if (value.startsWith("claude") || value.startsWith("qwen") || value.startsWith("llama") || value.startsWith("grok")) {
    return "o200k_base";
  }

  return null;
}

function registerCleanup() {
  if (cleanupRegistered) {
    return;
  }

  cleanupRegistered = true;
  process.once("exit", () => {
    for (const encoder of encoderCache.values()) {
      encoder.free();
    }
    encoderCache.clear();
  });
}

function getEncoder(model = null) {
  const normalizedModel = normalizeModelName(model);
  const cacheKey = normalizedModel ?? "o200k_base";

  if (encoderCache.has(cacheKey)) {
    return encoderCache.get(cacheKey);
  }

  const encoder = (() => {
    if (normalizedModel && normalizedModel !== "o200k_base") {
      return encoding_for_model(normalizedModel);
    }

    return get_encoding("o200k_base");
  })();

  encoderCache.set(cacheKey, encoder);
  registerCleanup();
  return encoder;
}

export function estimateTokenCount(value, options = {}) {
  const serialized = serializeForEstimation(value);
  if (!serialized) {
    return 0;
  }

  const encoder = getEncoder(options.model ?? null);
  return encoder.encode(serialized).length;
}

export function estimateLlmInvocationTokens(payload, result = null) {
  const model = payload.llm?.model ?? null;
  const estimatedInputTokens = [
    payload.prompt,
    payload.docs,
    payload.input,
    payload.schema,
    payload.context?.metadata ?? null,
  ].reduce((total, value) => total + estimateTokenCount(value, { model }), 0);

  const estimatedOutputTokens = estimateTokenCount(result, { model });

  return {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens: estimatedInputTokens + estimatedOutputTokens,
  };
}

export function createTrackedLlmHandlers(llms = {}, records = []) {
  return Object.fromEntries(
    Object.entries(llms).map(([provider, handler]) => [
      provider,
      async (payload) => {
        const startedAt = Date.now();

        try {
          const result = await handler(payload);
          const estimates = estimateLlmInvocationTokens(payload, result);

          records.push({
            provider,
            model: payload.llm?.model ?? null,
            durationMs: Date.now() - startedAt,
            ...estimates,
          });

          return result;
        } catch (error) {
          const estimates = estimateLlmInvocationTokens(payload, null);

          records.push({
            provider,
            model: payload.llm?.model ?? null,
            durationMs: Date.now() - startedAt,
            ...estimates,
            error: error.message,
          });

          throw error;
        }
      },
    ]),
  );
}

export function summarizeLlmRecords(records = []) {
  return {
    llmCalls: records.length,
    estimatedInputTokens: records.reduce((total, record) => total + record.estimatedInputTokens, 0),
    estimatedOutputTokens: records.reduce((total, record) => total + record.estimatedOutputTokens, 0),
    estimatedTotalTokens: records.reduce((total, record) => total + record.estimatedTotalTokens, 0),
  };
}
