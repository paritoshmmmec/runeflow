import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuiltinTools } from "../src/builtins.js";
import { createTrackedLlmHandlers, summarizeLlmRecords } from "./utils.js";
import { parseRuneflow } from "../src/parser.js";
import { runRuneflow } from "../src/runtime.js";
import { validateShape } from "../src/schema.js";

function parseOptions(argv) {
  const options = {
    cwd: process.cwd(),
    baseBranch: "main",
    rawFile: "eval/open-pr.raw.md",
    runeflowFile: "examples/open-pr.runeflow.md",
    runtimeFile: "eval/mock-runtime.js",
    mode: "both",
    delayMs: 0,
    model: null,
    provider: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--cwd") {
      options.cwd = path.resolve(value);
      index += 1;
    } else if (token === "--base-branch") {
      options.baseBranch = value;
      index += 1;
    } else if (token === "--raw") {
      options.rawFile = value;
      index += 1;
    } else if (token === "--runeflow") {
      options.runeflowFile = value;
      index += 1;
    } else if (token === "--runtime") {
      options.runtimeFile = value;
      index += 1;
    } else if (token === "--mode") {
      options.mode = value;
      index += 1;
    } else if (token === "--delay-ms") {
      options.delayMs = Number(value);
      index += 1;
    } else if (token === "--model") {
      options.model = value;
      index += 1;
    } else if (token === "--provider") {
      options.provider = value;
      index += 1;
    }
  }

  return options;
}

function applyModelOverride(definition, model) {
  if (!model) {
    return definition;
  }

  if (definition.metadata?.llm) {
    definition.metadata.llm.model = model;
  }

  for (const step of definition.workflow?.steps ?? []) {
    if (step.llm) {
      step.llm.model = model;
    }
  }

  return definition;
}

function applyProviderOverride(definition, provider) {
  if (!provider) {
    return definition;
  }

  if (definition.metadata?.llm) {
    definition.metadata.llm.provider = provider;
  }

  for (const step of definition.workflow?.steps ?? []) {
    if (step.llm) {
      step.llm.provider = provider;
    }
  }

  return definition;
}

function sleep(ms) {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }

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

async function collectOpenPrContext(cwd, baseBranch) {
  const tools = createBuiltinTools({ cwd });
  const [template, currentBranch, diffSummary] = await Promise.all([
    tools["file.exists"]({ path: ".github/pull_request_template.md" }),
    tools["git.current_branch"]({}),
    tools["git.diff_summary"]({ base: baseBranch }),
  ]);

  return {
    branch: currentBranch.branch,
    base_branch: baseBranch,
    template_exists: template.exists,
    diff_summary: diffSummary.summary,
    changed_files: diffSummary.files,
  };
}

async function runRawBaseline(rawDefinition, runtimeModule, context) {
  const records = [];
  const trackedLlms = createTrackedLlmHandlers(runtimeModule.llms ?? {}, records);
  const llm = rawDefinition.metadata.llm;

  if (!llm?.provider) {
    throw new Error("Raw baseline must declare metadata.llm.");
  }

  const handler = trackedLlms[llm.provider];
  if (typeof handler !== "function") {
    throw new Error(`No LLM handler registered for provider '${llm.provider}'.`);
  }

  const startedAt = Date.now();
  const prompt = [
    `Prepare a pull request draft for branch ${context.branch} targeting ${context.base_branch}.`,
    "",
    `PR template present: ${context.template_exists}`,
    `Changed files: ${JSON.stringify(context.changed_files)}`,
    "",
    "Diff summary:",
    context.diff_summary,
  ].join("\n");

  try {
    const result = await handler({
      llm,
      prompt,
      input: context,
      docs: rawDefinition.docs,
      schema: rawDefinition.metadata.outputs,
      context: {
        metadata: rawDefinition.metadata,
        mode: "raw-skill",
      },
    });

    const issues = validateShape(result, rawDefinition.metadata.outputs, "outputs");

    return {
      mode: "raw-skill",
      status: issues.length === 0 ? "success" : "failed",
      durationMs: Date.now() - startedAt,
      outputs: result,
      issues,
      usage: summarizeLlmRecords(records),
      llmCalls: records,
    };
  } catch (error) {
    return {
      mode: "raw-skill",
      status: "failed",
      durationMs: Date.now() - startedAt,
      outputs: null,
      issues: [error.message],
      usage: summarizeLlmRecords(records),
      llmCalls: records,
    };
  }
}

async function runRuneflowBaseline(runeflowDefinition, runtimeModule, baseBranch, cwd) {
  const records = [];
  const trackedRuntime = {
    ...runtimeModule,
    llms: createTrackedLlmHandlers(runtimeModule.llms ?? {}, records),
  };
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-eval-"));
  const startedAt = Date.now();

  try {
    const run = await runRuneflow(
      runeflowDefinition,
      { base_branch: baseBranch },
      trackedRuntime,
      { cwd, runsDir },
    );

    return {
      mode: "runeflow",
      status: run.status,
      durationMs: Date.now() - startedAt,
      outputs: run.outputs,
      issues: run.error ? [run.error.message] : [],
      usage: summarizeLlmRecords(records),
      llmCalls: records,
      runId: run.run_id,
      artifactPath: run.artifact_path,
    };
  } catch (error) {
    return {
      mode: "runeflow",
      status: "failed",
      durationMs: Date.now() - startedAt,
      outputs: null,
      issues: [error.message],
      usage: summarizeLlmRecords(records),
      llmCalls: records,
    };
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const repoRoot = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

  process.chdir(repoRoot);

  const [rawDefinition, runeflowDefinition, runtimeModule] = await Promise.all([
    loadParsedFile(options.rawFile),
    loadParsedFile(options.runeflowFile),
    loadModule(options.runtimeFile),
  ]);
  applyModelOverride(rawDefinition, options.model);
  applyModelOverride(runeflowDefinition, options.model);
  applyProviderOverride(rawDefinition, options.provider);
  applyProviderOverride(runeflowDefinition, options.provider);

  const context = await collectOpenPrContext(options.cwd, options.baseBranch);
  let rawSkill = null;
  let runeflow = null;

  if (options.mode !== "runeflow") {
    rawSkill = await runRawBaseline(rawDefinition, runtimeModule, context);
  }

  if (options.mode === "both") {
    await sleep(options.delayMs);
  }

  if (options.mode !== "raw") {
    runeflow = await runRuneflowBaseline(runeflowDefinition, runtimeModule, options.baseBranch, options.cwd);
  }

  console.log(JSON.stringify({
    task: "open-pr",
    comparedAt: new Date().toISOString(),
    cwd: options.cwd,
    baseBranch: options.baseBranch,
    requestedMode: options.mode,
    delayMs: options.delayMs,
    model: options.model ?? null,
    provider: options.provider ?? null,
    rawSkill,
    runeflow,
  }, null, 2));
}

await main();
