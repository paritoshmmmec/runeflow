import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPlainObject } from "./utils.js";

// Built-in registry ships with the package — always resolve relative to this file
const PACKAGE_REGISTRY_DIR = path.resolve(fileURLToPath(import.meta.url), "../../registry/tools");

function collectJsonFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(absolutePath);
    }
  }

  return files;
}

function normalizeEntry(entry, source = "tool registry") {
  if (!isPlainObject(entry)) {
    throw new Error(`${source}: expected registry entry to be an object`);
  }

  if (typeof entry.name !== "string" || !entry.name.trim()) {
    throw new Error(`${source}: registry entry is missing a tool name`);
  }

  return entry;
}

function loadDirRegistry(dir) {
  if (!fs.existsSync(dir)) return new Map();
  return new Map(collectJsonFiles(dir).map((filePath) => {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const entry = normalizeEntry(parsed, filePath);
    return [entry.name, entry];
  }));
}

export function normalizeToolRegistry(registry) {
  if (!registry) {
    return new Map();
  }

  if (registry instanceof Map) {
    return new Map(registry);
  }

  if (Array.isArray(registry)) {
    return new Map(registry.map((entry, index) => {
      const normalized = normalizeEntry(entry, `toolRegistry[${index}]`);
      return [normalized.name, normalized];
    }));
  }

  if (isPlainObject(registry)) {
    return new Map(Object.entries(registry).map(([key, value]) => {
      const normalized = normalizeEntry(value, `toolRegistry.${key}`);
      return [normalized.name, normalized];
    }));
  }

  throw new Error("toolRegistry must be a Map, array, or object");
}

export function loadToolRegistry(options = {}) {
  if (options.toolRegistry) {
    return normalizeToolRegistry(options.toolRegistry);
  }

  // 1. Load built-in registry (always available, resolved from package root)
  const builtinRegistry = loadDirRegistry(PACKAGE_REGISTRY_DIR);

  // 2. Load user registry from cwd (optional, merges on top — user entries win)
  const userRegistryDir = options.registryDir
    ? path.resolve(options.registryDir)
    : path.resolve(process.cwd(), "registry", "tools");

  const userRegistry = loadDirRegistry(userRegistryDir);

  // Merge: built-ins first, user entries override
  return new Map([...builtinRegistry, ...userRegistry]);
}

export function getToolOutputSchema(toolName, registry) {
  return registry.get(toolName)?.outputSchema ?? null;
}

export function getToolInputSchema(toolName, registry) {
  return registry.get(toolName)?.inputSchema ?? null;
}
