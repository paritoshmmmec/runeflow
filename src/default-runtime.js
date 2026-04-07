/**
 * Default Runeflow runtime — powered by Vercel AI SDK.
 *
 * Supports: openai, anthropic, cerebras, groq, mistral, google
 * Each provider package is an optional peer dependency — only install what you use:
 *
 *   npm install @ai-sdk/openai      → provider: openai
 *   npm install @ai-sdk/anthropic   → provider: anthropic
 *   npm install @ai-sdk/cerebras    → provider: cerebras
 *   npm install @ai-sdk/groq        → provider: groq
 *   npm install @ai-sdk/mistral     → provider: mistral
 *   npm install @ai-sdk/google      → provider: google
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

import { generateObject } from "ai";
import { z } from "zod";
import { resolveApiKey } from "./auth.js";
import { isPlainObject } from "./utils.js";

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

async function handleLlmStep({ llm, prompt, input, docs, schema, step }) {
  const provider = llm?.provider;
  if (!provider) {
    throw new Error(`Step '${step.id}' has no llm.provider configured.`);
  }

  const model = await loadModel(provider, llm, step.id);
  const zodSchema = runeflowSchemaToZod(schema ?? {});
  const fullPrompt = buildPrompt({ prompt, input, docs });

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
 * Supports openai, anthropic, cerebras, groq, mistral, google.
 *
 * Install only the providers you need:
 *   npm install @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/cerebras
 *
 * @returns {{ llms: Record<string, Function> }}
 */
export function createDefaultRuntime() {
  const handler = (payload) => handleLlmStep(payload);

  return {
    llms: Object.fromEntries(
      Object.keys(PROVIDER_FACTORIES).map((provider) => [provider, handler]),
    ),
  };
}

// Default export for --runtime flag usage
export default createDefaultRuntime();
