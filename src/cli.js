import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { importMarkdownSkill } from "./importer.js";
import { parseSkill } from "./parser.js";
import { runSkill } from "./runtime.js";
import { validateSkill } from "./validator.js";

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

export async function runCli(argv) {
  const [command, ...rest] = argv;
  const { positional, options } = parseOptions(rest);

  if (!command || command === "help" || command === "--help") {
    console.log(`Usage:
  skill validate <file>
  skill run <file> --input '{"key":"value"}' [--runtime ./runtime.js] [--runs-dir ./.skill-runs]
  skill inspect-run <run-id> [--runs-dir ./.skill-runs]
  skill import <file> [--output converted.skill.md]`);
    return;
  }

  if (command === "validate") {
    const target = positional[0];
    const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
    const definition = parseSkill(source, { sourcePath: target });
    const validation = validateSkill(definition);
    console.log(JSON.stringify(validation, null, 2));
    if (!validation.valid) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "run") {
    const target = positional[0];
    const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
    const definition = parseSkill(source, { sourcePath: target });
    const runtime = await loadRuntime(options.runtime);
    const input = await loadInput(options.input);
    const run = await runSkill(definition, input, runtime, {
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
    const runsDir = path.resolve(process.cwd(), options["runs-dir"] ?? ".skill-runs");
    const artifact = await fs.readFile(path.join(runsDir, `${runId}.json`), "utf8");
    console.log(JSON.stringify(JSON.parse(artifact), null, 2));
    return;
  }

  if (command === "import") {
    const target = positional[0];
    const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
    const converted = importMarkdownSkill(source, { sourcePath: target });
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
