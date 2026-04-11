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

function findPackageRoot(resolvedUrl, packageName) {
  let currentDir = path.dirname(fileURLToPath(resolvedUrl));

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        if (pkg?.name === packageName) {
          return currentDir;
        }
      } catch {
        // Ignore unreadable package.json files while walking upward.
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

export function resolvePackageRegistryProvidersDir(options = {}) {
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const resolvePackage = options.resolvePackage
    ?? ((specifier) => import.meta.resolve?.(specifier));

  try {
    const packageUrl = resolvePackage("runeflow-registry");
    if (typeof packageUrl === "string") {
      const packageRoot = findPackageRoot(packageUrl, "runeflow-registry");
      if (packageRoot) {
        return path.join(packageRoot, "providers");
      }
    }
  } catch {
    // Fall back to legacy relative lookups below.
  }

  const candidates = [
    path.resolve(fileURLToPath(moduleUrl), "../../node_modules/runeflow-registry/providers"),
    path.resolve(fileURLToPath(moduleUrl), "../../../runeflow-registry/providers"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
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

export function mergeToolRegistries(...registries) {
  return new Map(
    registries
      .filter(Boolean)
      .flatMap((registry) => [...normalizeToolRegistry(registry).entries()]),
  );
}

export function loadBaseToolRegistry(options = {}) {
  // 1. Load built-in registry (always available, resolved from package root)
  const builtinRegistry = loadDirRegistry(PACKAGE_REGISTRY_DIR);

  // 2. Auto-load runeflow-registry schemas if the package is installed.
  //    Each provider ships a schemas.json alongside its schemas.js.
  //    This is zero-config — install runeflow-registry and schemas appear in tools list.
  let packageRegistry = new Map();
  try {
    const registryProvidersDir = options.packageRegistryProvidersDir
      ?? resolvePackageRegistryProvidersDir();
    if (registryProvidersDir && fs.existsSync(registryProvidersDir)) {
      for (const entry of fs.readdirSync(registryProvidersDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const jsonPath = path.join(registryProvidersDir, entry.name, "schemas.json");
        if (!fs.existsSync(jsonPath)) continue;
        const schemas = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        for (const schema of schemas) {
          packageRegistry.set(schema.name, schema);
        }
      }
    }
  } catch {
    // runeflow-registry not installed — skip silently
  }

  // 3. Load user registry from cwd (optional, merges on top — user entries win)
  const userRegistryDir = options.registryDir
    ? path.resolve(options.registryDir)
    : path.resolve(process.cwd(), "registry", "tools");

  const userRegistry = loadDirRegistry(userRegistryDir);

  // Merge: built-ins first, package registry, user entries override
  return new Map([...builtinRegistry, ...packageRegistry, ...userRegistry]);
}

export function loadToolRegistry(options = {}) {
  return mergeToolRegistries(
    loadBaseToolRegistry(options),
    options.runtimeToolRegistry,
    options.toolRegistry,
  );
}

export function getToolOutputSchema(toolName, registry) {
  return registry.get(toolName)?.outputSchema ?? null;
}

export function getToolInputSchema(toolName, registry) {
  return registry.get(toolName)?.inputSchema ?? null;
}
