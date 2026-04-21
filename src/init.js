/**
 * runeflow init
 *
 * Orchestration sequence:
 *   1. Inspect the repo for signals
 *   2. Optionally resolve a cloud provider for polish
 *   3a. Convert Claude-style Markdown skills into Runeflow skills
 *   3b. Generate a new Runeflow skill from a heuristic template
 *
 * Writes project-level skills into `.runeflow/skills/` so they are immediately
 * discoverable via `runeflow skills list` and runnable via `runeflow skills run`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import { convertClaudeSkill } from "./init-converter.js";
import { selectTemplate, reselectWithAnswer } from "./init-heuristics.js";
import { inspectRepo } from "./init-inspector.js";
import { getTemplate } from "./init-templates/index.js";
import { buildExampleInput, getSkillsDir, slugify } from "./init-utils.js";
import { parseRuneflow } from "./parser.js";
import { validateRuneflow } from "./validator.js";

const CLOUD_PROVIDERS = [
  { envKey: "CEREBRAS_API_KEY", provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" },
  { envKey: "OPENAI_API_KEY", provider: "openai", model: "gpt-4o" },
  { envKey: "ANTHROPIC_API_KEY", provider: "anthropic", model: "claude-3-7-sonnet-latest" },
  { envKey: "GROQ_API_KEY", provider: "groq", model: "llama-3.3-70b-versatile" },
  { envKey: "MISTRAL_API_KEY", provider: "mistral", model: "mistral-large-latest" },
  { envKey: "GOOGLE_GENERATIVE_AI_API_KEY", provider: "google", model: "gemini-2.0-flash" },
];

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(`${question}: `, (answer) => resolve(answer.trim()));
  });
}

async function fileExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

function buildExplicitLlmConfig(options) {
  const llmConfig = {};

  if (typeof options.provider === "string" && options.provider.trim()) {
    llmConfig.provider = options.provider.trim();
  }

  if (typeof options.model === "string" && options.model.trim()) {
    llmConfig.model = options.model.trim();
  }

  return Object.keys(llmConfig).length > 0 ? llmConfig : null;
}

function resolvePolishProvider(options) {
  if (typeof options.provider === "string" && options.provider.trim()) {
    const knownProvider = CLOUD_PROVIDERS.find((entry) => entry.provider === options.provider.trim());
    if (!knownProvider) {
      return { provider: null, model: null };
    }

    return {
      provider: knownProvider.provider,
      model: options.model ?? knownProvider.model,
    };
  }

  for (const { envKey, provider, model } of CLOUD_PROVIDERS) {
    if (process.env[envKey]) {
      return { provider, model };
    }
  }

  return { provider: null, model: null };
}

async function polishSkill(content, { provider, model, log }) {
  log(`✨ Polishing with ${provider}...`);

  try {
    const { generateObject } = await import("ai");
    const { z } = await import("zod");

    const FACTORIES = {
      cerebras: async (key) => {
        const { createCerebras } = await import("@ai-sdk/cerebras");
        return createCerebras({ apiKey: key })(model);
      },
      openai: async (key) => {
        const { createOpenAI } = await import("@ai-sdk/openai");
        return createOpenAI({ apiKey: key })(model);
      },
      anthropic: async (key) => {
        const { createAnthropic } = await import("@ai-sdk/anthropic");
        return createAnthropic({ apiKey: key })(model);
      },
      groq: async (key) => {
        const { createGroq } = await import("@ai-sdk/groq");
        return createGroq({ apiKey: key })(model);
      },
      mistral: async (key) => {
        const { createMistral } = await import("@ai-sdk/mistral");
        return createMistral({ apiKey: key })(model);
      },
      google: async (key) => {
        const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
        return createGoogleGenerativeAI({ apiKey: key })(model);
      },
    };

    const envKeyMap = {
      cerebras: "CEREBRAS_API_KEY",
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      groq: "GROQ_API_KEY",
      mistral: "MISTRAL_API_KEY",
      google: "GOOGLE_GENERATIVE_AI_API_KEY",
    };

    const factory = FACTORIES[provider];
    const apiKey = process.env[envKeyMap[provider]];
    if (!factory || !apiKey) {
      return content;
    }

    const llmModel = await factory(apiKey);

    const { object } = await generateObject({
      model: llmModel,
      schema: z.object({ content: z.string() }),
      prompt: `You are a Runeflow skill author. Improve the following .md file:
- Make the operator guidance (Markdown prose) more specific and useful
- Improve the LLM step prompt to be more precise
- Keep all frontmatter, step structure, and output schema exactly as-is
- Return only the improved file content, no explanation

\`\`\`
${content}
\`\`\``,
    });

    return object.content ?? content;
  } catch {
    return content;
  }
}

async function tryPolish(content, { provider, model, noPolish, log }) {
  if (noPolish || !provider || !model) {
    return content;
  }

  try {
    const polished = await polishSkill(content, { provider, model, log });
    const parsed = parseRuneflow(polished);
    const result = validateRuneflow(parsed);

    if (!result.valid) {
      log("⚠️  Polish produced invalid output. Keeping the base scaffold.");
      return content;
    }

    return polished;
  } catch {
    log("⚠️  Polish failed. Keeping the base scaffold.");
    return content;
  }
}

function extractSkillNameFromContent(content) {
  const match = content.match(/^---\n[\s\S]*?^name:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function validateGeneratedContent(content) {
  const parsed = parseRuneflow(content);
  const result = validateRuneflow(parsed);
  if (!result.valid) {
    throw new Error(`Generated skill is invalid: ${result.issues.join("; ")}`);
  }
  return parsed;
}

function toDisplayPath(cwd, targetPath) {
  const relativePath = path.relative(cwd, targetPath);
  if (!relativePath || relativePath === "") {
    return ".";
  }
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function buildRunCommand(filePath, parsed) {
  const skillStem = path.basename(filePath, ".md");
  const exampleInput = buildExampleInput(parsed.metadata.inputs ?? {});
  return `runeflow skills run ${skillStem} --input '${JSON.stringify(exampleInput)}'`;
}

async function maybeLogAgentsHint(cwd, log) {
  const agentsPath = path.join(cwd, "AGENTS.md");
  const agentsContent = await fs.readFile(agentsPath, "utf8").catch(() => null);

  if (agentsContent && agentsContent.includes(".runeflow/skills/")) {
    return;
  }

  log("");
  log("Tip: add this to AGENTS.md so project skills are easy for agents to discover:");
  log("  ## Runeflow Skills");
  log("  Skills are in `.runeflow/skills/`. Run `runeflow skills list` to see available workflows.");
}

function logNextSteps(cwd, log, filePath, parsed, options = {}) {
  const displayPath = toDisplayPath(cwd, filePath);

  log("");
  log("Next:");
  log("  runeflow skills list");
  log(`  runeflow validate ${displayPath}`);
  log(`  ${buildRunCommand(filePath, parsed)}`);

  if (options.selectionId === "generic-llm-task") {
    log(`  Edit ${displayPath} to tighten the prompt and schema before first run.`);
  }

  if (options.warningCount > 0) {
    log(`  Review ${displayPath}; ${options.warningCount} conversion warning(s) need manual attention.`);
  }
}

async function writeSkillFile(content, skillName, cwd, force) {
  const skillsDir = getSkillsDir(cwd);
  await fs.mkdir(skillsDir, { recursive: true });

  const filePath = path.join(skillsDir, `${skillName}.md`);
  if (await fileExists(filePath) && !force) {
    throw new Error(`${path.basename(filePath)} already exists in .runeflow/skills/. Use --force to overwrite.`);
  }

  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function runConversionMode(signals, options, ctx) {
  const { cwd, isTTY, log, polishProvider, polishModel, llmConfig } = ctx;
  const { noPolish, force } = options;
  const { claudeSkillFiles } = signals;

  let filesToConvert = claudeSkillFiles;

  if (isTTY && claudeSkillFiles.length > 0) {
    log("");
    log("Detected Claude-style Markdown files:");
    claudeSkillFiles.forEach((file, index) => {
      log(`  ${index + 1}. ${file.relativePath} - ${file.title}`);
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await ask(rl, "Which files should Runeflow convert? (comma-separated numbers, or Enter for all)");
      if (answer.trim()) {
        const indexes = answer
          .split(",")
          .map((value) => Number.parseInt(value.trim(), 10) - 1)
          .filter((value) => value >= 0 && value < claudeSkillFiles.length);

        if (indexes.length > 0) {
          filesToConvert = indexes.map((index) => claudeSkillFiles[index]);
        }
      }
    } finally {
      rl.close();
    }
  }

  const writtenPaths = [];

  for (const skillFile of filesToConvert) {
    const source = await fs.readFile(skillFile.path, "utf8").catch(() => null);
    if (source === null) {
      log(`⚠️  Could not read ${skillFile.relativePath}; skipping.`);
      continue;
    }

    const converted = convertClaudeSkill(source, {
      sourcePath: skillFile.relativePath,
      llmConfig,
    });

    const content = await tryPolish(converted.output, {
      provider: polishProvider,
      model: polishModel,
      noPolish,
      log,
    });

    const parsed = validateGeneratedContent(content);
    const skillName = slugify(extractSkillNameFromContent(content) ?? path.basename(skillFile.path, ".md"));
    const filePath = await writeSkillFile(content, skillName, cwd, force);
    writtenPaths.push(filePath);

    log(`✅ Created ${toDisplayPath(cwd, filePath)} from ${skillFile.relativePath}`);

    for (const warning of converted.warnings) {
      log(`  ⚠️  ${warning}`);
    }

    logNextSteps(cwd, log, filePath, parsed, {
      warningCount: converted.warnings.length,
    });
  }

  await maybeLogAgentsHint(cwd, log);
  return writtenPaths;
}

async function runGenerationMode(signals, options, ctx) {
  const { cwd, isTTY, log, polishProvider, polishModel, llmConfig } = ctx;
  const { noPolish, force } = options;

  let selection = selectTemplate(signals, { forceTemplate: options.template });
  log(`📋 Template: ${selection.templateId}`);

  if (!selection.confident && isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await ask(rl, "What do you want to automate?");
      if (answer) {
        selection = reselectWithAnswer(signals, answer);
        log(`📋 Template (updated): ${selection.templateId}`);
      }
    } finally {
      rl.close();
    }
  }

  const template = getTemplate(selection.templateId);
  if (!template) {
    throw new Error(`Template "${selection.templateId}" not found.`);
  }

  const baseContent = template.generate(signals, {
    name: options.name,
    llmConfig,
  });

  const content = await tryPolish(baseContent, {
    provider: polishProvider,
    model: polishModel,
    noPolish,
    log,
  });

  const parsed = validateGeneratedContent(content);
  const skillName = slugify(extractSkillNameFromContent(content) ?? selection.templateId);
  const filePath = await writeSkillFile(content, skillName, cwd, force);

  log(`✅ Created ${toDisplayPath(cwd, filePath)}`);
  logNextSteps(cwd, log, filePath, parsed, {
    selectionId: selection.templateId,
  });
  await maybeLogAgentsHint(cwd, log);

  return [filePath];
}

export async function runInit(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  const log = options.silent ? () => {} : (...args) => console.log(...args);

  const signals = await inspectRepo({
    cwd,
    extraContext: options.context ? [options.context] : [],
  });

  const explicitLlmConfig = buildExplicitLlmConfig(options);
  const { provider: polishProvider, model: polishModel } = resolvePolishProvider(options);

  if (!options.noPolish && !polishProvider) {
    log("ℹ️  No cloud provider configured for init polish. Generating the minimal scaffold directly.");
  }

  const ctx = {
    cwd,
    isTTY,
    log,
    llmConfig: explicitLlmConfig,
    polishProvider,
    polishModel,
  };

  if (signals.claudeSkillFiles.length > 0) {
    return runConversionMode(signals, options, ctx);
  }

  return runGenerationMode(signals, options, ctx);
}
