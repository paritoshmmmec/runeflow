/**
 * Eval harness for release-notes.md
 *
 * Runs the runeflow skill against a fixture and reports token usage + outputs.
 *
 * Usage:
 *   node --env-file=.env ./eval/release-notes.js
 *   node --env-file=.env ./eval/release-notes.js --provider openai
 *   node --env-file=.env ./eval/release-notes.js --base-ref v0.1.0
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTrackedLlmHandlers, summarizeLlmRecords } from "./utils.js";
import { parseRuneflow } from "../src/parser.js";
import { runRuneflow } from "../src/runtime.js";

function parseOptions(argv) {
  const options = {
    runeflowFile: "examples/release-notes.md",
    runtimeFile: "eval/release-notes-runtime.js",
    fixtureFile: "eval/fixtures/release-notes.default.json",
    baseRef: null,
    model: null,
    provider: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--runeflow") { options.runeflowFile = value; index += 1; }
    else if (token === "--runtime") { options.runtimeFile = value; index += 1; }
    else if (token === "--fixture") { options.fixtureFile = value; index += 1; }
    else if (token === "--base-ref") { options.baseRef = value; index += 1; }
    else if (token === "--model") { options.model = value; index += 1; }
    else if (token === "--provider") { options.provider = value; index += 1; }
  }

  return options;
}

async function loadModule(relativePath) {
  const absolutePath = path.resolve(relativePath);
  const module = await import(pathToFileURL(absolutePath).href);
  return module.default ?? module;
}

async function loadParsedFile(relativePath) {
  const absolutePath = path.resolve(relativePath);
  const source = await fs.readFile(absolutePath, "utf8");
  return parseRuneflow(source, { sourcePath: absolutePath });
}

async function loadFixture(relativePath) {
  const absolutePath = path.resolve(relativePath);
  const source = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(source);
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const repoRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  process.chdir(repoRoot);

  const [definition, runtimeModule, fixture] = await Promise.all([
    loadParsedFile(options.runeflowFile),
    loadModule(options.runtimeFile),
    loadFixture(options.fixtureFile),
  ]);

  // Apply overrides
  if (options.model && definition.metadata?.llm) definition.metadata.llm.model = options.model;
  if (options.provider && definition.metadata?.llm) definition.metadata.llm.provider = options.provider;

  const baseRuntime = typeof runtimeModule.createRuntime === "function"
    ? await runtimeModule.createRuntime({ fixturePath: options.fixtureFile })
    : runtimeModule;

  const records = [];
  const runtime = {
    ...baseRuntime,
    llms: createTrackedLlmHandlers(baseRuntime.llms ?? {}, records),
  };

  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-eval-"));
  const startedAt = Date.now();

  const run = await runRuneflow(
    definition,
    { base_ref: options.baseRef ?? fixture.base_ref },
    runtime,
    { runsDir },
  );

  console.log(JSON.stringify({
    task: "release-notes",
    ranAt: new Date().toISOString(),
    baseRef: options.baseRef ?? fixture.base_ref,
    model: options.model ?? null,
    provider: options.provider ?? null,
    status: run.status,
    durationMs: Date.now() - startedAt,
    outputs: run.outputs,
    issues: run.error ? [run.error.message] : [],
    usage: summarizeLlmRecords(records),
    llmCalls: records,
    runId: run.run_id,
    artifactPath: run.artifact_path,
  }, null, 2));

  if (run.status !== "success") process.exitCode = 1;
}

await main();
