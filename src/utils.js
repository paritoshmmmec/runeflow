import fs from "node:fs/promises";
import path from "node:path";

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
 * Expand ${VAR} references in a string using process.env.
 * Non-string values are returned as-is.
 */
export function expandEnvVars(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
}

/**
 * Recursively walk a value and expand ${VAR} in all string leaves.
 */
export function deepExpandEnvVars(value) {
  if (typeof value === "string") return expandEnvVars(value);
  if (Array.isArray(value)) return value.map(deepExpandEnvVars);
  if (isPlainObject(value)) {
    const result = {};
    for (const [k, v] of Object.entries(value)) result[k] = deepExpandEnvVars(v);
    return result;
  }
  return value;
}
