/**
 * Default Runeflow runtime — powered by Vercel AI SDK.
 *
 * Zero-install auto path:
 *   1. Claude Code CLI (`claude`) if available
 *   2. Vercel AI Gateway (`AI_GATEWAY_API_KEY`)
 *
 * Explicit direct providers remain available for advanced users:
 *
 *   npm install @ai-sdk/openai      → provider: openai
 *   npm install @ai-sdk/anthropic   → provider: anthropic
 *   npm install @ai-sdk/cerebras    → provider: cerebras
 *   npm install @ai-sdk/groq        → provider: groq
 *   npm install @ai-sdk/mistral     → provider: mistral
 *   npm install @ai-sdk/google      → provider: google
 *
 * Auto-selection: when a skill omits `llm.provider`, the runtime prefers
 * Claude Code on local machines and otherwise falls back to AI Gateway.
 * A model-only config like `model: anthropic/claude-sonnet-4.6` is treated
 * as an explicit Gateway request.
 *
 * API keys are resolved via the auth waterfall:
 *   1. process.env
 *   2. <cwd>/.env
 *   3. ~/.runeflow/credentials.json
 *
 * Usage:
 *   import { createDefaultRuntime } from "runeflow";
 *   const runtime = createDefaultRuntime();
 *   await runRuneflow(definition, inputs, runtime, options);
 */

import { createGateway, generateObject, streamObject } from "ai";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { resolveApiKey } from "./auth.js";
import { callClaudeCli } from "./claude-cli-provider.js";
import { isPlainObject } from "./utils.js";

const DEFAULT_GATEWAY_MODEL = "anthropic/claude-sonnet-4.6";

// ─── Schema conversion: Runeflow schema → Zod ────────────────────────────────

function runeflowSchemaToZod(schema) {
  // Shorthand string primitive: "string" | "number" | "boolean"
  if (typeof schema === "string") {
    switch (schema) {
      case "string":  return z.string();
      case "number":  return z.number();
      case "boolean": return z.boolean();
      case "integer": return z.number().int();
      case "any":     return z.any();
      case "object":  return z.record(z.any());
      default:        return z.any();
    }
  }

  // Shorthand array: [itemSchema]
  if (Array.isArray(schema)) {
    if (schema.length === 1) {
      return z.array(runeflowSchemaToZod(schema[0]));
    }
    return z.array(z.any());
  }

  if (!isPlainObject(schema)) return z.any();

  // JSON Schema node detection — must have explicit `type` or look like a JSON Schema object
  // Shorthand objects with an `items` key are NOT JSON Schema arrays
  const looksLikeJsonSchema = (
    (typeof schema.type === "string") ||
    ("properties" in schema && !("items" in schema)) ||
    ("required" in schema && !("items" in schema))
  );

  if (looksLikeJsonSchema) {
    const type = schema.type;

    if (type === "string")  return z.string();
    if (type === "number")  return z.number();
    if (type === "integer") return z.number().int();
    if (type === "boolean") return z.boolean();

    if (type === "array") {
      const itemSchema = schema.items ? runeflowSchemaToZod(schema.items) : z.any();
      return z.array(itemSchema);
    }

    if (type === "object" || schema.properties !== undefined) {
      return buildZodObject(schema);
    }

    return z.any();
  }

  // Shorthand object: { key: "string", nested: { ... }, items: [...] }
  return buildZodObject(schema);
}

function buildZodObject(schema) {
  const properties = schema.properties ?? schema;
  const required = Array.isArray(schema.required) ? new Set(schema.required) : null;

  if (!isPlainObject(properties)) return z.record(z.any());

  const shape = {};
  for (const [key, value] of Object.entries(properties)) {
    // Skip JSON Schema meta-keys when processing shorthand objects
    if (key === "type" || key === "required" || key === "additionalProperties" || key === "description") {
      continue;
    }
    let fieldSchema = runeflowSchemaToZod(value);
    // In JSON Schema, fields not in required[] are optional
    if (required && !required.has(key)) {
      fieldSchema = fieldSchema.optional();
    }
    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

// ─── Provider loader (lazy, graceful error if package not installed) ──────────

const PROVIDER_FACTORIES = {
  gateway: {
    envKey: "AI_GATEWAY_API_KEY",
    load: async (apiKey, llm) => {
      const gateway = createGateway({ apiKey });
      return gateway(llm.model ?? DEFAULT_GATEWAY_MODEL);
    },
  },
  openai: {
    envKey: "OPENAI_API_KEY",
    load: async (apiKey, llm) => {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey })(llm.model ?? "gpt-4o");
    },
  },
  anthropic: {
    envKey: "ANTHROPIC_API_KEY",
    load: async (apiKey, llm) => {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey })(llm.model ?? "claude-3-7-sonnet-latest");
    },
  },
  cerebras: {
    envKey: "CEREBRAS_API_KEY",
    load: async (apiKey, llm) => {
      const { createCerebras } = await import("@ai-sdk/cerebras");
      return createCerebras({ apiKey })(llm.model ?? "qwen-3-235b-a22b-instruct-2507");
    },
  },
  groq: {
    envKey: "GROQ_API_KEY",
    load: async (apiKey, llm) => {
      const { createGroq } = await import("@ai-sdk/groq");
      return createGroq({ apiKey })(llm.model ?? "llama-3.3-70b-versatile");
    },
  },
  mistral: {
    envKey: "MISTRAL_API_KEY",
    load: async (apiKey, llm) => {
      const { createMistral } = await import("@ai-sdk/mistral");
      return createMistral({ apiKey })(llm.model ?? "mistral-large-latest");
    },
  },
  google: {
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    load: async (apiKey, llm) => {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey })(llm.model ?? "gemini-2.0-flash");
    },
  },
};

// ─── Auto-selection ───────────────────────────────────────────────────────────

function isGatewayModelId(model) {
  return typeof model === "string" && /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9._-]+$/i.test(model.trim());
}

function envHasKey(provider) {
  const factory = PROVIDER_FACTORIES[provider];
  if (!factory) return false;
  try {
    // Use resolveApiKey to honor process.env + .env + credentials.json.
    return Boolean(resolveApiKey(provider, "_auto-select"));
  } catch {
    return false;
  }
}

// Auto-select state is cached across calls in one process for two reasons:
//   - `which claude` is a syscall we don't want to repeat per step
//   - the "auto-selected provider=…" stderr line should only print once
// Tests can force a fresh check via `_resetAutoSelectCache` (same pattern
// as _resetEnvAllowlistCache in src/utils.js).
let claudeCliChecked = false;
let claudeCliAvailable = false;
let autoSelectAnnounced = false;

export function _resetAutoSelectCache() {
  claudeCliChecked = false;
  claudeCliAvailable = false;
  autoSelectAnnounced = false;
}

function hasClaudeCli() {
  if (claudeCliChecked) return claudeCliAvailable;
  claudeCliChecked = true;
  try {
    execFileSync("which", ["claude"], { stdio: "pipe" });
    claudeCliAvailable = true;
  } catch {
    claudeCliAvailable = false;
  }
  return claudeCliAvailable;
}

function announceAutoSelect(provider, source) {
  if (autoSelectAnnounced) return;
  if (process.env.RUNEFLOW_QUIET === "1") return;
  autoSelectAnnounced = true;
  process.stderr.write(
    `runeflow: auto-selected provider=${provider} (${source})\n`,
  );
}

/**
 * Pick a provider based on available credentials. Returns a partial
 * llm config ({ provider, model? }) or throws with a clear message
 * listing every env var that would have been accepted.
 */
export function autoSelectProvider() {
  if (hasClaudeCli()) {
    announceAutoSelect("claude-cli", "found claude on PATH");
    return { provider: "claude-cli" };
  }

  if (envHasKey("gateway")) {
    announceAutoSelect("gateway", `found ${PROVIDER_FACTORIES.gateway.envKey}`);
    return { provider: "gateway" };
  }

  throw new Error(
    `No zero-install LLM path is available.\n` +
    `Install the Claude CLI (https://docs.anthropic.com/claude-code) or set AI_GATEWAY_API_KEY.\n` +
    `Runeflow checks process.env, .env, and ~/.runeflow/credentials.json for AI_GATEWAY_API_KEY.`,
  );
}

async function loadModel(provider, llm, stepId) {
  const factory = PROVIDER_FACTORIES[provider];

  if (!factory) {
    throw new Error(
      `Unknown provider '${provider}' for step '${stepId}'. ` +
      `Supported: ${Object.keys(PROVIDER_FACTORIES).join(", ")}`,
    );
  }

  const apiKey = resolveApiKey(provider, stepId);

  try {
    return await factory.load(apiKey, llm);
  } catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" || error.message?.includes("Cannot find package")) {
      throw new Error(
        `Provider package for '${provider}' is not installed.\n` +
        `  Fix: npm install @ai-sdk/${provider}`,
      );
    }
    throw error;
  }
}

// ─── Message builder ──────────────────────────────────────────────────────────

function buildPrompt({ prompt, input, docs }) {
  const parts = [];

  if (docs?.trim()) {
    parts.push(docs.trim());
    parts.push("");
  }

  parts.push(prompt);

  if (input && Object.keys(input).length > 0) {
    parts.push("");
    parts.push("Resolved input:");
    parts.push(JSON.stringify(input, null, 2));
  }

  return parts.join("\n");
}

// ─── Core handler ─────────────────────────────────────────────────────────────

async function handleLlmStep({ llm, prompt, input, docs, schema, step, onPartialObject }) {
  let effectiveLlm = llm;

  if (!effectiveLlm?.provider) {
    if (isGatewayModelId(effectiveLlm?.model)) {
      announceAutoSelect("gateway", `using model=${effectiveLlm.model}`);
      effectiveLlm = { ...(llm ?? {}), provider: "gateway" };
    } else {
      // Merge any model override from the original config onto the auto-pick.
      effectiveLlm = { ...(llm ?? {}), ...autoSelectProvider() };
    }
  }

  const provider = effectiveLlm.provider;
  const zodSchema = runeflowSchemaToZod(schema ?? {});
  const fullPrompt = buildPrompt({ prompt, input, docs });

  // Claude CLI path — shell out to `claude -p` and parse the JSON response.
  if (provider === "claude-cli") {
    return callClaudeCli({
      prompt: fullPrompt,
      schema: zodSchema,
      model: effectiveLlm.model,
      stepId: step.id,
    });
  }

  const model = await loadModel(provider, effectiveLlm, step.id);

  if (typeof onPartialObject === "function") {
    const result = streamObject({
      model,
      schema: zodSchema,
      prompt: fullPrompt,
    });

    for await (const partial of result.partialObjectStream) {
      onPartialObject({ stepId: step.id, partial });
    }

    return (await result.object);
  }

  const { object } = await generateObject({
    model,
    schema: zodSchema,
    prompt: fullPrompt,
  });

  return object;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a default runtime backed by the Vercel AI SDK.
 * Zero-install defaults: Claude Code CLI and AI Gateway.
 * Advanced direct providers: gateway, openai, anthropic, cerebras, groq,
 * mistral, google.
 *
 * @returns {{ llms: Record<string, Function> }}
 */
export function createDefaultRuntime() {
  const handler = (payload) => handleLlmStep(payload);

  const llms = Object.fromEntries(
    Object.keys(PROVIDER_FACTORIES).map((provider) => [provider, handler]),
  );
  // Route for Claude CLI fallback.
  llms["claude-cli"] = handler;
  // Sentinel: the runtime calls handler with this key when no provider is
  // declared anywhere. handleLlmStep() will auto-select inside.
  llms["_auto"] = handler;

  return { llms };
}

// Default export for --runtime flag usage
export default createDefaultRuntime();
