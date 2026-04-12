import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTrackedLlmHandlers, summarizeLlmRecords } from "./utils.js";
import { parseRuneflow } from "../src/parser.js";
import { runRuneflow } from "../src/runtime.js";
import { validateShape } from "../src/schema.js";

function parseOptions(argv) {
  const options = {
    rawFile: "eval/adyntel-automation.raw.md",
    runeflowFile: "eval/adyntel-automation.md",
    runtimeFile: "eval/adyntel-runtime.js",
    fixtureFile: "eval/fixtures/adyntel-automation.default.json",
    taskQuery: "Update john doe lead",
    mode: "both",
    delayMs: 0,
    model: null,
    provider: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--raw") { options.rawFile = value; index += 1; }
    else if (token === "--runeflow") { options.runeflowFile = value; index += 1; }
    else if (token === "--runtime") { options.runtimeFile = value; index += 1; }
    else if (token === "--fixture") { options.fixtureFile = value; index += 1; }
    else if (token === "--task") { options.taskQuery = value; index += 1; }
    else if (token === "--mode") { options.mode = value; index += 1; }
    else if (token === "--delay-ms") { options.delayMs = Number(value); index += 1; }
    else if (token === "--model") { options.model = value; index += 1; }
    else if (token === "--provider") { options.provider = value; index += 1; }
  }
  return options;
}

function applyModelOverride(definition, model) {
  if (!model) return definition;
  if (definition.metadata?.llm) definition.metadata.llm.model = model;
  for (const step of definition.workflow?.steps ?? []) {
    if (step.llm) step.llm.model = model;
  }
  return definition;
}

function applyProviderOverride(definition, provider) {
  if (!provider) return definition;
  if (definition.metadata?.llm) definition.metadata.llm.provider = provider;
  for (const step of definition.workflow?.steps ?? []) {
    if (step.llm) step.llm.provider = provider;
  }
  return definition;
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildContext(fixture, options) {
  return {
    task_query: options.taskQuery ?? fixture.task_query,
  };
}

async function createRuntime(runtimeModule, options) {
  if (typeof runtimeModule.createRuntime === "function") {
    return runtimeModule.createRuntime(options);
  }
  return runtimeModule;
}

async function runRawBaseline(rawDefinition, runtime, context) {
  const records = [];
  const trackedLlms = createTrackedLlmHandlers(runtime.llms ?? {}, records);
  const llm = rawDefinition.metadata.llm;

  if (!llm?.provider) throw new Error("Raw baseline must declare metadata.llm.");
  const handler = trackedLlms[llm.provider];
  if (typeof handler !== "function") throw new Error(`No LLM handler for ${llm.provider}`);

  const startedAt = Date.now();
  const prompt = [
    `Execute the following Adyntel operation using the provided context: ${context.task_query}`,
    "",
    "Follow the execution patterns inside your docs strictly.",
  ].join("\n");

  const input = {
    task_query: context.task_query,
  };

  try {
    const result = await handler({
      llm, prompt, input, docs: rawDefinition.docs,
      schema: rawDefinition.metadata.outputs,
      context: { metadata: rawDefinition.metadata, mode: "raw-skill" },
    });

    const issues = validateShape(result, rawDefinition.metadata.outputs, "outputs");

    return {
      mode: "raw-skill",
      status: issues.length === 0 ? "success" : "failed",
      durationMs: Date.now() - startedAt,
      outputs: result, issues, usage: summarizeLlmRecords(records), llmCalls: records,
    };
  } catch (error) {
    return {
      mode: "raw-skill", status: "failed", durationMs: Date.now() - startedAt,
      outputs: null, issues: [error.message], usage: summarizeLlmRecords(records), llmCalls: records,
    };
  }
}

async function runRuneflowBaseline(runeflowDefinition, runtime, context) {
  const records = [];
  const trackedRuntime = {
    ...runtime,
    llms: createTrackedLlmHandlers(runtime.llms ?? {}, records),
  };
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-eval-"));
  const startedAt = Date.now();

  try {
    const run = await runRuneflow(
      runeflowDefinition,
      { task_query: context.task_query },
      trackedRuntime,
      { runsDir },
    );
    const issues = run.error ? [run.error.message] : [];

    return {
      mode: "runeflow",
      status: run.status === "success" && issues.length === 0 ? "success" : "failed",
      durationMs: Date.now() - startedAt,
      outputs: run.outputs, issues, usage: summarizeLlmRecords(records),
      llmCalls: records, runId: run.run_id, artifactPath: run.artifact_path,
    };
  } catch (error) {
    return {
      mode: "runeflow", status: "failed", durationMs: Date.now() - startedAt,
      outputs: null, issues: [error.message], usage: summarizeLlmRecords(records), llmCalls: records,
    };
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const repoRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  process.chdir(repoRoot);

  const [rawDefinition, runeflowDefinition, runtimeModule, fixture] = await Promise.all([
    loadParsedFile(options.rawFile),
    loadParsedFile(options.runeflowFile),
    loadModule(options.runtimeFile),
    loadFixture(options.fixtureFile),
  ]);
  applyModelOverride(rawDefinition, options.model);
  applyModelOverride(runeflowDefinition, options.model);
  applyProviderOverride(rawDefinition, options.provider);
  applyProviderOverride(runeflowDefinition, options.provider);

  const runtime = await createRuntime(runtimeModule, { fixturePath: options.fixtureFile });
  const context = buildContext(fixture, options);

  let rawSkill = null; let runeflow = null;
  if (options.mode !== "runeflow") rawSkill = await runRawBaseline(rawDefinition, runtime, context);
  if (options.mode === "both") await sleep(options.delayMs);
  if (options.mode !== "raw") runeflow = await runRuneflowBaseline(runeflowDefinition, runtime, context);

  console.log(JSON.stringify({
    task: "adyntel-automation", comparedAt: new Date().toISOString(),
    requestedMode: options.mode, delayMs: options.delayMs,
    model: options.model ?? null, provider: options.provider ?? null,
    taskQuery: context.task_query,
    rawSkill, runeflow,
  }, null, 2));
}

await main();
