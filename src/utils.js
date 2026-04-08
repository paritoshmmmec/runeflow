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
