/**
 * Shared utilities for runeflow init and template generation.
 */

import path from "node:path";

/**
 * Standard slugification for names and identifiers.
 * Converts to lowercase, replaces non-alphanumeric with dashes, and trims dashes.
 * @param {string} str
 * @returns {string}
 */
export function slugify(str) {
  if (!str) return "";
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getSkillsDir(cwd) {
  return path.join(cwd, ".runeflow", "skills");
}

export function commandForPackageScript(packageManager, scriptName) {
  if (!scriptName) {
    return "";
  }

  switch (packageManager) {
    case "pnpm":
      return `pnpm ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "npm":
    default:
      return `npm run ${scriptName}`;
  }
}

function exampleValueForType(type) {
  if (Array.isArray(type)) {
    return [];
  }

  if (type && typeof type === "object") {
    if (type.type === "array") {
      return [];
    }

    if (type.type === "object" || type.properties) {
      return {};
    }

    return {};
  }

  switch (type) {
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "string":
    default:
      return "TODO";
  }
}

export function buildExampleInput(inputShape = {}) {
  const result = {};
  for (const [key, type] of Object.entries(inputShape)) {
    result[key] = exampleValueForType(type);
  }
  return result;
}
