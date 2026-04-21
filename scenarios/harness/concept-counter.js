#!/usr/bin/env node
/**
 * concept-counter.js
 *
 * Pure function + thin CLI. Given a .md skill file, returns the set of
 * "concepts" it uses. One concept ≈ one README section an author had to
 * read to write the skill. The scenarios harness uses this set as the
 * DX metric: lower is better, and each concept is budget-able.
 *
 * Usage:
 *   node concept-counter.js <path-to-skill.md>
 *   # prints newline-separated concept names, exits 0
 *
 * Import:
 *   import { countConcepts } from "./concept-counter.js";
 *   const concepts = countConcepts(markdownString);
 *   // Set { "step.cli", "step.llm", "interpolation", "schema.llm" }
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkill } from "../../src/index.js";
import { createBuiltinTools } from "../../src/builtins.js";

const BUILTIN_TOOL_NAMES = new Set(Object.keys(createBuiltinTools()));

function walkStringValues(value, visit) {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStringValues(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) walkStringValues(v, visit);
  }
}

function hasInterpolation(step) {
  let found = false;
  walkStringValues(step, (s) => {
    if (!found && s.includes("{{")) found = true;
  });
  return found;
}

export function countConcepts(source) {
  const concepts = new Set();
  const parsed = parseSkill(source);

  // Frontmatter concepts
  if (parsed.metadata?.llm) concepts.add("frontmatter.llm");
  if (parsed.metadata?.mcp_servers) concepts.add("frontmatter.mcp_servers");
  if (parsed.metadata?.composio) concepts.add("frontmatter.composio");
  if (parsed.consts && Object.keys(parsed.consts).length > 0) {
    concepts.add("frontmatter.const");
  }

  // Imports
  if (parsed.workflow?.imports && parsed.workflow.imports.length > 0) {
    concepts.add("import");
  }

  // Per-step concepts
  const steps = parsed.workflow?.steps ?? [];
  for (const step of steps) {
    if (step.kind) concepts.add(`step.${step.kind}`);

    // Modifiers on the step header
    if (step.retry && step.retry > 0) concepts.add("retry");
    if (step.fallback) concepts.add("fallback");
    if (step.cache === false) concepts.add("cache=false");
    if (step.skip_if) concepts.add("skip_if");

    // Bindings / schemas
    if (step.with && Object.keys(step.with).length > 0) concepts.add("with");
    if (step.out) concepts.add("schema.out");
    if (step.schema) concepts.add("schema.llm");

    // Interpolation anywhere in the step body
    if (hasInterpolation(step)) concepts.add("interpolation");

    // Classify tool references
    if (step.kind === "tool" && step.tool) {
      if (BUILTIN_TOOL_NAMES.has(step.tool)) {
        concepts.add("tool.builtin");
      } else {
        concepts.add("tool.registry");
      }
    }
  }

  // Workflow-level output block can also use interpolation
  if (parsed.workflow?.output && hasInterpolation(parsed.workflow.output)) {
    concepts.add("interpolation");
  }

  return concepts;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: concept-counter.js <skill.md>");
    process.exit(2);
  }
  const source = fs.readFileSync(path.resolve(process.cwd(), target), "utf8");
  const concepts = countConcepts(source);
  for (const c of [...concepts].sort()) console.log(c);
}
