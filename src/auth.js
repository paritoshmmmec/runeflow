/**
 * Auth waterfall for LLM providers.
 *
 * Resolution order for each provider key:
 *   1. process.env (already set in environment)
 *   2. <cwd>/.env  (loaded on demand, not mutating process.env)
 *   3. ~/.runeflow/credentials.json
 *
 * Fails fast with a clear, actionable message if a key is missing.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PROVIDER_KEY_MAP = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  composio: "COMPOSIO_API_KEY",
  ollama: null, // local, no auth needed
};

// ─── .env parser (no dependencies) ───────────────────────────────────────────

function parseDotEnv(content) {
  const result = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadDotEnv(cwd) {
  const envPath = path.join(cwd ?? process.cwd(), ".env");
  try {
    return parseDotEnv(fs.readFileSync(envPath, "utf8"));
  } catch {
    return {};
  }
}

function loadCredentialsJson() {
  const credPath = path.join(os.homedir(), ".runeflow", "credentials.json");
  try {
    return JSON.parse(fs.readFileSync(credPath, "utf8"));
  } catch {
    return {};
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve an API key for a provider using the auth waterfall.
 * Returns the key string or null if the provider needs no auth (e.g. ollama).
 * Throws with a clear message if the key is required but not found.
 *
 * @param {string} provider  - e.g. "openai", "cerebras"
 * @param {string} stepId    - used in the error message
 * @param {object} options   - { cwd }
 */
export function resolveApiKey(provider, stepId, options = {}) {
  const envKey = PROVIDER_KEY_MAP[provider];

  // Provider needs no auth
  if (envKey === null) return null;

  // Unknown provider — let the handler deal with it
  if (envKey === undefined) return undefined;

  // 1. Environment variable
  if (process.env[envKey]) return process.env[envKey];

  // 2. .env file in cwd
  const dotEnv = loadDotEnv(options.cwd);
  if (dotEnv[envKey]) return dotEnv[envKey];

  // 3. ~/.runeflow/credentials.json
  const credentials = loadCredentialsJson();
  if (credentials[envKey]) return credentials[envKey];

  throw new Error(
    `Missing ${envKey} for step '${stepId}' (provider: ${provider}).\n` +
    `  Fix: export ${envKey}=your-key\n` +
    `  Or:  echo "${envKey}=your-key" >> .env\n` +
    `  Or:  add "${envKey}" to ~/.runeflow/credentials.json`,
  );
}

/**
 * Pre-flight auth check — validates all llm steps in a definition have
 * resolvable credentials before execution starts.
 *
 * @param {object} definition - parsed runeflow definition
 * @param {object} options    - { cwd }
 * @returns {string[]}        - list of error messages (empty = all good)
 */
export function checkAuth(definition, options = {}) {
  const errors = [];
  const checked = new Set();

  for (const step of definition.workflow?.steps ?? []) {
    if (step.kind !== "llm") continue;
    const llmConfig = step.llm ?? definition.metadata?.llm;
    if (!llmConfig?.provider) continue;

    const provider = llmConfig.provider;
    if (checked.has(provider)) continue;
    checked.add(provider);

    try {
      resolveApiKey(provider, step.id, options);
    } catch (error) {
      errors.push(error.message);
    }
  }

  return errors;
}
