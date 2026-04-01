import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { importMarkdownRuneflow } from "./importer.js";
import { parseRuneflow } from "./parser.js";
import { runRuneflow } from "./runtime.js";
import { validateRuneflow } from "./validator.js";

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

export async function runCli(argv) {
  const [command, ...rest] = argv;
  const { positional, options } = parseOptions(rest);

  if (!command || command === "help" || command === "--help") {
    console.log(`Usage:
  runeflow validate <file>
  runeflow run <file> --input '{"key":"value"}' [--runtime ./runtime.js] [--runs-dir ./${DEFAULT_RUNS_DIR}]
  runeflow inspect-run <run-id> [--runs-dir ./${DEFAULT_RUNS_DIR}]
  runeflow import <file> [--output converted.runeflow.md]`);
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

  throw new Error(`Unknown command '${command}'.`);
}
