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
    rawFile: "eval/3p-updates.raw.md",
    runeflowFile: "eval/3p-updates.md",
    runtimeFile: "eval/3p-runtime.js",
    fixtureFile: "eval/fixtures/3p-updates.default.json",
    teamName: null,
    periodLabel: null,
    mode: "both",
    delayMs: 0,
    model: null,
    provider: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];

    if (token === "--raw") {
      options.rawFile = value;
      index += 1;
    } else if (token === "--runeflow") {
      options.runeflowFile = value;
      index += 1;
    } else if (token === "--runtime") {
      options.runtimeFile = value;
      index += 1;
    } else if (token === "--fixture") {
      options.fixtureFile = value;
      index += 1;
    } else if (token === "--team-name") {
      options.teamName = value;
      index += 1;
    } else if (token === "--period-label") {
      options.periodLabel = value;
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validate3pFormatted(output, context) {
  if (!output || typeof output.formatted !== "string") {
    return ["formatted output is missing"];
  }

  const expectedPattern = new RegExp(
    `^.+ ${escapeRegExp(context.team_name)} \\(${escapeRegExp(context.period_label)}\\)\\nProgress: [^\\n]+\\nPlans: [^\\n]+\\nProblems: [^\\n]+$`,
  );

  const issues = [];
  if (!expectedPattern.test(output.formatted.trim())) {
    issues.push("formatted output does not match the required 4-line plain-text 3P format");
  }

  if (/^\s*[*•-]\s/m.test(output.formatted)) {
    issues.push("formatted output should not use markdown bullets or list markers");
  }

  return issues;
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
    team_name: options.teamName ?? fixture.team_name,
    period_label: options.periodLabel ?? fixture.period_label,
    slack_highlights: fixture.sources?.slack ?? [],
    drive_highlights: fixture.sources?.gdrive ?? [],
    email_highlights: fixture.sources?.email ?? [],
    calendar_highlights: fixture.sources?.calendar ?? [],
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

  if (!llm?.provider) {
    throw new Error("Raw baseline must declare metadata.llm.");
  }

  const handler = trackedLlms[llm.provider];
  if (typeof handler !== "function") {
    throw new Error(`No LLM handler registered for provider '${llm.provider}'.`);
  }

  const startedAt = Date.now();
  const prompt = [
    `Write a concise 3P update for the ${context.team_name} team covering ${context.period_label}.`,
    "",
    "Use the gathered workplace context below.",
  ].join("\n");

  const input = {
    team_name: context.team_name,
    period_label: context.period_label,
    slack_highlights: context.slack_highlights,
    drive_highlights: context.drive_highlights,
    email_highlights: context.email_highlights,
    calendar_highlights: context.calendar_highlights,
  };

  try {
    const result = await handler({
      llm,
      prompt,
      input,
      docs: rawDefinition.docs,
      schema: rawDefinition.metadata.outputs,
      context: {
        metadata: rawDefinition.metadata,
        mode: "raw-skill",
      },
    });

    const issues = [
      ...validateShape(result, rawDefinition.metadata.outputs, "outputs"),
      ...validate3pFormatted(result, context),
    ];

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
      {
        team_name: context.team_name,
        period_label: context.period_label,
      },
      trackedRuntime,
      { runsDir },
    );
    const issues = run.error ? [run.error.message] : validate3pFormatted(run.outputs, context);

    return {
      mode: "runeflow",
      status: run.status === "success" && issues.length === 0 ? "success" : "failed",
      durationMs: Date.now() - startedAt,
      outputs: run.outputs,
      issues,
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

  const runtime = await createRuntime(runtimeModule, {
    fixturePath: options.fixtureFile,
  });
  const context = buildContext(fixture, options);

  let rawSkill = null;
  let runeflow = null;

  if (options.mode !== "runeflow") {
    rawSkill = await runRawBaseline(rawDefinition, runtime, context);
  }

  if (options.mode === "both") {
    await sleep(options.delayMs);
  }

  if (options.mode !== "raw") {
    runeflow = await runRuneflowBaseline(runeflowDefinition, runtime, context);
  }

  console.log(JSON.stringify({
    task: "3p-updates",
    comparedAt: new Date().toISOString(),
    requestedMode: options.mode,
    delayMs: options.delayMs,
    model: options.model ?? null,
    provider: options.provider ?? null,
    teamName: context.team_name,
    periodLabel: context.period_label,
    rawSkill,
    runeflow,
  }, null, 2));
}

await main();
