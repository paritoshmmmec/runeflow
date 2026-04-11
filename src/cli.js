import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import chokidar from "chokidar";
import cron from "node-cron";
import { assembleRuneflow } from "./assembler.js";
import { dryrunRuneflow } from "./dryrun.js";
import { runTest, loadFixture } from "./test-runner.js";
import { importMarkdownRuneflow } from "./importer.js";
import { runInit } from "./init.js";
import { parseRuneflow } from "./parser.js";
import { closeRuntimePlugins, createRuntimeEnvironment } from "./runtime-plugins.js";
import { runRuneflow } from "./runtime.js";
import { loadToolRegistry } from "./tool-registry.js";
import { validateRuneflow } from "./validator.js";
import { buildRuneflow } from "./builder.js";

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
    const next = argumentsList[index + 1];

    // Treat as a boolean flag if no next token, or next token is another flag
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }

  return { positional, options };
}

async function loadRuntime(runtimePath) {
  if (!runtimePath) {
    return {};
  }

  const absolutePath = path.resolve(process.cwd(), runtimePath);
  const module = await import(pathToFileURL(absolutePath).href);
  return await (module.default ?? module);
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
    if (
      artifact.runeflow?.name === skillName
      && (artifact.status === "halted_on_error" || artifact.status === "halted_on_input")
    ) {
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

function createPromptSession() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return {
      promptHandler: undefined,
      close: () => {},
    };
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    promptHandler: async ({ step, prompt, choices, defaultValue }) => {
      const choiceSuffix = Array.isArray(choices) && choices.length
        ? ` [${choices.join("/")}]`
        : "";
      const defaultSuffix = defaultValue !== undefined
        ? ` (default: ${typeof defaultValue === "string" ? defaultValue : JSON.stringify(defaultValue)})`
        : "";

      while (true) {
        const answer = await rl.question(`${prompt}${choiceSuffix}${defaultSuffix}\n> `);

        if (!answer && defaultValue !== undefined) {
          return defaultValue;
        }

        if (!Array.isArray(choices) || choices.length === 0 || choices.includes(answer)) {
          return answer;
        }

        console.error(
          `Invalid answer for '${step.id}'. Expected one of: ${choices.join(", ")}`,
        );
      }
    },
    close: () => rl.close(),
  };
}

async function executeRun(target, options = {}) {
  const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
  const definition = parseRuneflow(source, { sourcePath: target });
  const runtime = await loadRuntime(options.runtime);
  const input = await loadInput(options.input);
  const promptValues = await loadInput(options.prompt);
  const runsDir = options["runs-dir"] ? path.resolve(process.cwd(), options["runs-dir"]) : undefined;
  const promptSession = options.interactivePrompts === false
    ? { promptHandler: undefined, close: () => {} }
    : createPromptSession();

  try {
    const run = await runRuneflow(definition, input, runtime, {
      runsDir,
      force: Boolean(options.force),
      promptValues,
      promptHandler: promptSession.promptHandler,
    });

    return { definition, run, runsDir };
  } finally {
    promptSession.close();
  }
}

export async function runCli(argv) {
  const [command, ...rest] = argv;
  const { positional, options } = parseOptions(rest);

  if (!command || command === "help" || command === "--help") {
    console.log(`Usage:
  runeflow init [--name <name>] [--context <hint>] [--template <id>]
               [--provider <provider>] [--model <model>]
               [--no-local-llm] [--no-polish] [--force]
  runeflow validate <file> [--runtime ./runtime.js]
  runeflow run <file> --input '{"key":"value"}' [--runtime ./runtime.js] [--runs-dir ./${DEFAULT_RUNS_DIR}] [--force]
  runeflow test <file> --fixture <fixture.json> [--runtime ./runtime.js] [--runs-dir ./${DEFAULT_RUNS_DIR}]
  runeflow resume <file> [--runtime ./runtime.js] [--runs-dir ./${DEFAULT_RUNS_DIR}] [--prompt '{"step":"answer"}']
  runeflow watch <file> [--input '{"key":"value"}'] [--runtime ./runtime.js] [--runs-dir ./${DEFAULT_RUNS_DIR}] [--cron "0 9 * * 1-5"] [--on-change "src/**/*.js"]
  runeflow assemble <file> --step <step-id> --input '{"key":"value"}' [--runtime ./runtime.js] [--output context.md]
  runeflow inspect-run <run-id> [--runs-dir ./${DEFAULT_RUNS_DIR}]
  runeflow import <file> [--output converted.runeflow.md]
  runeflow dryrun <file> --input '{"key":"value"}' [--runtime ./runtime.js]
  runeflow tools list [--runtime ./runtime.js]
  runeflow tools inspect <tool-name> [--runtime ./runtime.js]`);
    return;
  }

  if (command === "init") {
    await runInit({
      name: options.name,
      description: options.description,
      provider: options.provider,
      model: options.model,
      force: Boolean(options.force),
      context: options.context,
      template: options.template,
      noLocalLlm: Boolean(options["no-local-llm"]),
      noPolish: Boolean(options["no-polish"]),
    });
    return;
  }

  if (command === "validate") {
    const target = positional[0];
    const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
    const definition = parseRuneflow(source, { sourcePath: target });
    const runtime = await loadRuntime(options.runtime);
    const effectiveRuntime = createRuntimeEnvironment(runtime, {});
    try {
      const validation = validateRuneflow(definition, {
        runtimeToolRegistry: effectiveRuntime.toolRegistry,
      });
      console.log(JSON.stringify(validation, null, 2));
      if (!validation.valid) {
        process.exitCode = 1;
      }
    } finally {
      await closeRuntimePlugins(effectiveRuntime).catch(() => {});
    }
    return;
  }

  if (command === "run") {
    const target = positional[0];
    const { run } = await executeRun(target, options);
    console.log(JSON.stringify(run, null, 2));
    if (run.status !== "success") {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "test") {
    const target = positional[0];
    if (!target) throw new Error("Usage: runeflow test <file> --fixture <fixture.json>");
    const fixturePath = options.fixture;
    if (!fixturePath) throw new Error("--fixture <path> is required for runeflow test");

    const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
    const definition = parseRuneflow(source, { sourcePath: target });
    const runtime = await loadRuntime(options.runtime);
    const fixture = await loadFixture(fixturePath);
    const runsDir = options["runs-dir"] ? path.resolve(process.cwd(), options["runs-dir"]) : undefined;

    const result = await runTest(definition, fixture, { runtime, runsDir });

    console.log(JSON.stringify({
      pass: result.pass,
      failures: result.failures,
      status: result.run?.status ?? null,
      run_id: result.run?.run_id ?? null,
    }, null, 2));

    if (!result.pass) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "build") {
    const description = positional[0];
    if (!description) throw new Error("Usage: runeflow build <description> [--provider <p>] [--model <m>] [--out <file>]");

    const provider = options.provider;
    const model = options.model;
    const runtime = await loadRuntime(options.runtime);

    const output = await buildRuneflow(description, { provider, model, runtime });

    if (options.out) {
      await fs.writeFile(path.resolve(process.cwd(), options.out), output, "utf8");
      console.log(`Written to ${options.out}`);
    } else {
      console.log(output);
    }
    return;
  }

  if (command === "dryrun") {
    const target = positional[0];
    const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
    const definition = parseRuneflow(source, { sourcePath: target });
    const runtime = await loadRuntime(options.runtime);
    const inputArg = options.input ?? "{}";
    const inputs = JSON.parse(inputArg);
    const plan = await dryrunRuneflow(definition, inputs, runtime);
    console.log(JSON.stringify(plan, null, 2));
    if (!plan.valid) {
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
    const promptValues = await loadInput(options.prompt);
    const promptSession = createPromptSession();
    let run;
    try {
      run = await runRuneflow(definition, priorRun.inputs, runtime, {
        runsDir,
        priorSteps,
        resumeFromStep: priorRun.halted_step_id,
        promptValues,
        promptHandler: promptSession.promptHandler,
      });
    } finally {
      promptSession.close();
    }
    console.log(JSON.stringify(run, null, 2));
    if (run.status !== "success") {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "assemble") {
    const target = positional[0];
    if (!target) throw new Error("Usage: runeflow assemble <file> --step <step-id> --input '{}'");
    const stepId = options.step;
    if (!stepId) throw new Error("--step <step-id> is required for assemble");

    const source = await fs.readFile(path.resolve(process.cwd(), target), "utf8");
    const definition = parseRuneflow(source, { sourcePath: target });
    const runtime = await loadRuntime(options.runtime);
    const input = await loadInput(options.input);

    const assembled = await assembleRuneflow(definition, stepId, input, runtime);

    if (options.output) {
      await fs.writeFile(path.resolve(process.cwd(), options.output), assembled);
      console.error(`Written to ${options.output}`);
    } else {
      console.log(assembled);
    }
    return;
  }

  if (command === "watch") {
    const target = positional[0];
    const cronExpr = options.cron;
    const watchPattern = options["on-change"];

    if (!target) {
      throw new Error("Usage: runeflow watch <file> [--cron '<expr>'] [--on-change '<glob>']");
    }

    if (!cronExpr && !watchPattern) {
      throw new Error("runeflow watch requires --cron or --on-change");
    }

    let running = false;
    let pendingTrigger = null;
    let shuttingDown = false;

    const scheduleRun = async (trigger) => {
      if (running) {
        pendingTrigger = trigger;
        return;
      }

      running = true;

      try {
        const { run } = await executeRun(target, {
          ...options,
          interactivePrompts: false,
        });

        console.log(JSON.stringify({
          event: "watch.run",
          trigger,
          status: run.status,
          run_id: run.run_id,
          artifact_path: run.artifact_path,
        }, null, 2));
      } catch (error) {
        console.error(JSON.stringify({
          event: "watch.error",
          trigger,
          error: {
            name: error.name,
            message: error.message,
          },
        }, null, 2));
      } finally {
        running = false;
        if (pendingTrigger && !shuttingDown) {
          const nextTrigger = pendingTrigger;
          pendingTrigger = null;
          await scheduleRun(nextTrigger);
        }
      }
    };

    const resources = [];

    if (cronExpr) {
      if (!cron.validate(cronExpr)) {
        throw new Error(`Invalid cron expression '${cronExpr}'`);
      }

      const task = cron.schedule(cronExpr, () => {
        void scheduleRun({
          type: "cron",
          cron: cronExpr,
          at: new Date().toISOString(),
        });
      });
      resources.push(() => task.stop());
    }

    if (watchPattern) {
      const patterns = watchPattern.split(",").map((value) => value.trim()).filter(Boolean);
      const watcher = chokidar.watch(patterns, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100,
        },
      });

      watcher.on("all", (event, changedPath) => {
        void scheduleRun({
          type: "change",
          event,
          path: changedPath,
          at: new Date().toISOString(),
        });
      });

      resources.push(() => watcher.close());
    }

    console.log(JSON.stringify({
      event: "watch.started",
      target,
      cron: cronExpr ?? null,
      on_change: watchPattern ?? null,
    }, null, 2));

    await new Promise((resolve) => {
      const cleanup = async () => {
        shuttingDown = true;
        await Promise.all(resources.map((close) => close()));
        resolve();
      };

      process.once("SIGINT", () => {
        void cleanup();
      });
      process.once("SIGTERM", () => {
        void cleanup();
      });
    });

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
    const runtime = await loadRuntime(options.runtime);
    const effectiveRuntime = createRuntimeEnvironment(runtime, {});
    try {
      const registry = loadToolRegistry({
        runtimeToolRegistry: effectiveRuntime.toolRegistry,
      });
      const builtinNames = new Set(Object.keys(createRuntimeEnvironment({}, {}).tools));

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
    } finally {
      await closeRuntimePlugins(effectiveRuntime).catch(() => {});
    }
  }

  throw new Error(`Unknown command '${command}'.`);
}
