import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { importMarkdownRuneflow } from "./importer.js";
import { parseRuneflow } from "./parser.js";
import { runRuneflow } from "./runtime.js";
import { loadToolRegistry } from "./tool-registry.js";
import { validateRuneflow } from "./validator.js";
import { createBuiltinTools } from "./builtins.js";

const DEFAULT_RUNS_DIR = ".runeflow-runs";
const LEGACY_RUNS_DIR = ".skill-runs";

function parseOptions(argumentsList) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const token = argumentsList[index];

    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const value = argumentsList[index + 1];
    options[key] = value;
    index += 1;
  }

  return { positional, options };
}

async function loadRuntime(runtimePath) {
  if (!runtimePath) {
    return {};
  }

  const absolutePath = path.resolve(process.cwd(), runtimePath);
  const module = await import(pathToFileURL(absolutePath).href);
  return module.default ?? module;
}

async function loadInput(rawInput) {
  if (!rawInput) {
    return {};
  }

  if (rawInput.startsWith("@")) {
    const filePath = path.resolve(process.cwd(), rawInput.slice(1));
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  }

  return JSON.parse(rawInput);
}

async function loadRunArtifact(runId, runsDir, fallbackRunsDir = null) {
  try {
    return await fs.readFile(path.join(runsDir, `${runId}.json`), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT" || !fallbackRunsDir) {
      throw error;
    }

    return fs.readFile(path.join(fallbackRunsDir, `${runId}.json`), "utf8");
  }
}

async function findLatestHaltedRun(skillName, runsDir) {
  let entries;
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    return null;
  }

  const runFiles = entries
    .filter((f) => f.endsWith(".json") && f.startsWith("run_"))
    .sort()
    .reverse();

  for (const file of runFiles) {
    const raw = await fs.readFile(path.join(runsDir, file), "utf8");
    const artifact = JSON.parse(raw);
    if (artifact.runeflow?.name === skillName && artifact.status === "halted_on_error") {
      return artifact;
    }
  }

  return null;
}

async function loadPriorSteps(runArtifact, runsDir) {
  const priorSteps = {};
  for (const step of runArtifact.steps ?? []) {
    if (step.artifact_path) {
      try {
        const raw = await fs.readFile(step.artifact_path, "utf8");
        priorSteps[step.id] = JSON.parse(raw);
      } catch {
        priorSteps[step.id] = step;
      }
    } else {
      priorSteps[step.id] = step;
    }
  }
  return priorSteps;
}

export async function runCli(argv) {
  const [command, ...rest] = argv;
  const { positional, options } = parseOptions(rest);

  if (!command || command === "help" || command === "--help") {
    console.log(`Usage:
  runeflow validate <file>
  runeflow run <file> --input '{"key":"value"}' [--runtime ./runtime.js] [--runs-dir ./${DEFAULT_RUNS_DIR}]
  runeflow resume <file> [--runtime ./runtime.js] [--runs-dir ./${DEFAULT_RUNS_DIR}]
  runeflow inspect-run <run-id> [--runs-dir ./${DEFAULT_RUNS_DIR}]
  runeflow import <file> [--output converted.runeflow.md]
  runeflow tools list
  runeflow tools inspect <tool-name>`);
    return;
  }

  if (command === "validate") {
    const target = positional[0];
    const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
    const definition = parseRuneflow(source, { sourcePath: target });
    const validation = validateRuneflow(definition);
    console.log(JSON.stringify(validation, null, 2));
    if (!validation.valid) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "run") {
    const target = positional[0];
    const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
    const definition = parseRuneflow(source, { sourcePath: target });
    const runtime = await loadRuntime(options.runtime);
    const input = await loadInput(options.input);
    const run = await runRuneflow(definition, input, runtime, {
      runsDir: options["runs-dir"] ? path.resolve(process.cwd(), options["runs-dir"]) : undefined,
    });
    console.log(JSON.stringify(run, null, 2));
    if (run.status !== "success") {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "inspect-run") {
    const runId = positional[0];
    const runsDir = path.resolve(process.cwd(), options["runs-dir"] ?? DEFAULT_RUNS_DIR);
    const fallbackRunsDir = options["runs-dir"] ? null : path.resolve(process.cwd(), LEGACY_RUNS_DIR);
    const artifact = await loadRunArtifact(runId, runsDir, fallbackRunsDir);
    console.log(JSON.stringify(JSON.parse(artifact), null, 2));
    return;
  }

  if (command === "resume") {
    const target = positional[0];
    const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
    const definition = parseRuneflow(source, { sourcePath: target });
    const runsDir = options["runs-dir"]
      ? path.resolve(process.cwd(), options["runs-dir"])
      : path.resolve(process.cwd(), DEFAULT_RUNS_DIR);

    const priorRun = await findLatestHaltedRun(definition.metadata.name, runsDir);
    if (!priorRun) {
      throw new Error(`No halted run found for '${definition.metadata.name}' in ${runsDir}`);
    }

    const priorSteps = await loadPriorSteps(priorRun, runsDir);
    const runtime = await loadRuntime(options.runtime);
    const run = await runRuneflow(definition, priorRun.inputs, runtime, {
      runsDir,
      priorSteps,
      resumeFromStep: priorRun.halted_step_id,
    });
    console.log(JSON.stringify(run, null, 2));
    if (run.status !== "success") {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "import") {
    const target = positional[0];
    const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
    const converted = importMarkdownRuneflow(source, { sourcePath: target });
    if (options.output) {
      await fs.writeFile(path.resolve(process.cwd(), options.output), converted);
      console.log(JSON.stringify({ written: options.output }, null, 2));
    } else {
      console.log(converted);
    }
    return;
  }

  if (command === "tools") {
    const subcommand = positional[0];
    const registry = loadToolRegistry();
    // Merge builtin tool names so we can cross-reference descriptions from registry
    const builtinNames = new Set(Object.keys(createBuiltinTools()));

    if (!subcommand || subcommand === "list") {
      const rows = [];
      for (const [name, entry] of registry) {
        const tag = builtinNames.has(name) ? "[builtin]" : "[registry]";
        rows.push(`  ${name.padEnd(36)} ${tag.padEnd(12)} ${entry.description ?? ""}`);
      }
      // Include any builtins not yet in registry
      for (const name of builtinNames) {
        if (!registry.has(name)) {
          rows.push(`  ${name.padEnd(36)} ${"[builtin]".padEnd(12)} (no registry entry)`);
        }
      }
      rows.sort();
      console.log(rows.join("\n"));
      return;
    }

    if (subcommand === "inspect") {
      const toolName = positional[1];
      if (!toolName) {
        throw new Error("Usage: runeflow tools inspect <tool-name>");
      }
      const entry = registry.get(toolName);
      if (!entry) {
        throw new Error(`Tool '${toolName}' not found in registry. Run 'runeflow tools list' to see available tools.`);
      }
      console.log(JSON.stringify(entry, null, 2));
      return;
    }

    throw new Error(`Unknown tools subcommand '${subcommand}'. Use 'list' or 'inspect <name>'.`);
  }

  throw new Error(`Unknown command '${command}'.`);
}
