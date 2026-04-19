import fs from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";

export function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

export function countIndent(line) {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

export function ensureDir(dirPath) {
  return fs.mkdir(dirPath, { recursive: true });
}

export function resolveMaybeRelative(baseDir, targetPath) {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.resolve(baseDir, targetPath);
}

export function serializeError(error) {
  if (!error) {
    return null;
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      ...(error.data !== undefined ? { data: error.data } : {}),
    };
  }

  return {
    name: "Error",
    message: String(error),
    stack: null,
  };
}

export function getByPath(value, segments) {
  let current = value;

  for (const segment of segments) {
    if (current === null || current === undefined || !(segment in current)) {
      return { found: false, value: undefined };
    }

    current = current[segment];
  }

  return { found: true, value: current };
}

/**
 * Default env var allowlist for ${VAR} expansion in skill frontmatter.
 *
 * Only these variables (plus any added via RUNEFLOW_ENV_ALLOWLIST) are
 * expanded when processing mcp_servers / composio configs. This prevents
 * a malicious .md file from exfiltrating sensitive env vars through
 * URLs, headers, or arguments.
 *
 * Extend at runtime:  RUNEFLOW_ENV_ALLOWLIST=MY_VAR,OTHER_VAR
 * Disable the guard:  RUNEFLOW_ENV_ALLOWLIST=*
 */
const DEFAULT_ENV_ALLOWLIST = new Set([
  // LLM provider keys — needed for composio / MCP auth
  "AI_GATEWAY_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CEREBRAS_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  // Composio
  "COMPOSIO_API_KEY",
  "COMPOSIO_CONNECTED_ACCOUNT_ID",
  "COMPOSIO_USER_ID",
  "COMPOSIO_ENTITY_ID",
  "COMPOSIO_TOOLKIT_VERSION_GITHUB",
  "COMPOSIO_TOOLKIT_VERSION_LINEAR",
  // Common integration variables
  "GITHUB_TOKEN",
  "MCP_SERVER_URL",
  "MCP_AUTH_TOKEN",
  // Node / runtime
  "NODE_ENV",
  "HOME",
  "PATH",
]);

function buildEnvAllowlist() {
  const raw = process.env.RUNEFLOW_ENV_ALLOWLIST;

  // Bypass: allow all
  if (raw === "*") return null;

  const extended = new Set(DEFAULT_ENV_ALLOWLIST);
  if (raw) {
    for (const key of raw.split(",")) {
      const trimmed = key.trim();
      if (trimmed) extended.add(trimmed);
    }
  }
  return extended;
}

let _cachedAllowlist;

function getEnvAllowlist() {
  if (_cachedAllowlist === undefined) {
    _cachedAllowlist = buildEnvAllowlist();
  }
  return _cachedAllowlist;
}

/** @internal — exported for tests */
export function _resetEnvAllowlistCache() {
  _cachedAllowlist = undefined;
}

/**
 * Expand ${VAR} references in a string using process.env.
 * Non-string values are returned as-is.
 *
 * When called without an allowlist (or with allowlist=null), expands
 * any variable — this is the low-level helper used by programmatic callers
 * who have already validated trust.
 */
export function expandEnvVars(value, allowlist = undefined) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    if (allowlist !== undefined && allowlist !== null && !allowlist.has(key)) {
      process.stderr.write(
        `[runeflow] blocked env var expansion: \${${key}} is not in the allowlist. ` +
        `Add it via RUNEFLOW_ENV_ALLOWLIST=${key}\n`,
      );
      return "";
    }
    return process.env[key] ?? "";
  });
}

/**
 * Recursively walk a value and expand ${VAR} in all string leaves.
 *
 * Uses the env var allowlist by default — only variables in the allowlist
 * (or extended via RUNEFLOW_ENV_ALLOWLIST) are expanded. Unrecognized
 * variables resolve to empty string with a warning on stderr.
 *
 * Set RUNEFLOW_ENV_ALLOWLIST=* to disable the guard entirely.
 */
export function deepExpandEnvVars(value) {
  const allowlist = getEnvAllowlist();

  function walk(current) {
    if (typeof current === "string") return expandEnvVars(current, allowlist);
    if (Array.isArray(current)) return current.map(walk);
    if (isPlainObject(current)) {
      const result = {};
      for (const [k, v] of Object.entries(current)) result[k] = walk(v);
      return result;
    }
    return current;
  }

  return walk(value);
}

/**
 * Evaluate a transform expression in a restricted vm context.
 * Uses Node's built-in `vm` module to prevent accidental access to globals
 * like `process`, `require`, and `fs`. Not a true security sandbox — treat
 * .md files as trusted code — but prevents unintentional side effects.
 */
export function evalTransformExpr(expr, input) {
  return runInNewContext(`(${expr})`, { input });
}

/**
 * Escape a value for safe interpolation into a shell command.
 * Wraps the value in single quotes and escapes any embedded single quotes
 * using the standard sh idiom: replace ' with '\'' (end quote, escaped
 * literal quote, reopen quote).
 *
 * Non-string values are JSON-serialized first.
 */
export function shellEscape(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return "'" + str.replace(/'/g, "'\\''") + "'";
}
