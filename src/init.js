/**
 * runeflow init — smarter-init orchestrator.
 *
 * Orchestration sequence:
 *   1. Inspect repo (signals)
 *   2. Resolve provider/model
 *   3a. Conversion_Mode — if Claude skill files detected
 *   3b. Generation_Mode — heuristic template selection
 *
 * Writes:
 *   <slug>.runeflow.md   — the skill file (or converted files)
 *   runtime.js           — runtime wired to the resolved provider
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import { inspectRepo } from "./init-inspector.js";
import { convertClaudeSkill } from "./init-converter.js";
import { selectTemplate, reselectWithAnswer } from "./init-heuristics.js";
import { getTemplate } from "./init-templates/index.js";
import { parseRuneflow } from "./parser.js";
import { validateRuneflow } from "./validator.js";
import { slugify } from "./init-utils.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLOUD_PROVIDERS = [
  { envKey: "CEREBRAS_API_KEY",            provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" },
  { envKey: "OPENAI_API_KEY",              provider: "openai",   model: "gpt-4o" },
  { envKey: "ANTHROPIC_API_KEY",           provider: "anthropic", model: "claude-3-7-sonnet-latest" },
  { envKey: "GROQ_API_KEY",               provider: "groq",     model: "llama-3.3-70b-versatile" },
  { envKey: "MISTRAL_API_KEY",            provider: "mistral",  model: "mistral-large-latest" },
  { envKey: "GOOGLE_GENERATIVE_AI_API_KEY", provider: "google", model: "gemini-2.0-flash" },
];

const LOCAL_MODEL_NAME = "qwen2.5-0.5b-instruct-q4_k_m.gguf";
const LOCAL_MODEL_URL = `https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/${LOCAL_MODEL_NAME}`;
const LOCAL_MODEL_CACHE_DIR = path.join(os.homedir(), ".runeflow", "models");
const LOCAL_MODEL_PATH = path.join(LOCAL_MODEL_CACHE_DIR, LOCAL_MODEL_NAME);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(`${question}: `, (answer) => resolve(answer.trim()));
  });
}

async function fileExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

function resolveProvider(options) {
  // 1. Explicit flag takes priority
  if (options.provider) {
    const knownProvider = CLOUD_PROVIDERS.find((p) => p.provider === options.provider);
    const model = options.model ?? knownProvider?.model ?? "unknown";
    return { provider: options.provider, model, isCloud: !!knownProvider };
  }

  // 2. Check env keys in priority order
  for (const { envKey, provider, model } of CLOUD_PROVIDERS) {
    if (process.env[envKey]) {
      return { provider, model, isCloud: true };
    }
  }

  // 3. No key found — use local
  return { provider: "local", model: LOCAL_MODEL_NAME, isCloud: false };
}

// ---------------------------------------------------------------------------
// LLM Polisher (inline)
// ---------------------------------------------------------------------------

async function polishSkill(content, { provider, model, log }) {
  log(`✨ Polishing with ${provider}...`);

  // polish via AI SDK would go here — requires peer dep (@ai-sdk/<provider>)
  // Skipping actual LLM call to avoid mandatory peer dependency.
  // The property tests mock this function directly.
  return content;
}

async function tryPolish(content, { provider, model, isCloud, noPolish, log }) {
  if (noPolish || !isCloud) return content;

  try {
    const polished = await polishSkill(content, { provider, model, log });
    // Validate polished output
    const parsed = parseRuneflow(polished);
    const result = validateRuneflow(parsed);
    if (!result.valid) {
      log("⚠️  Polish produced invalid skill — using original.");
      return content;
    }
    return polished;
  } catch {
    log("⚠️  Polish failed — using original.");
    return content;
  }
}

// ---------------------------------------------------------------------------
// Local model download
// ---------------------------------------------------------------------------

async function downloadModel(log) {
  await fs.mkdir(LOCAL_MODEL_CACHE_DIR, { recursive: true });

  return new Promise((resolve, reject) => {
    const file = fsSync.createWriteStream(LOCAL_MODEL_PATH);

    function doRequest(url, redirectCount = 0) {
      if (redirectCount > 5) {
        file.destroy();
        fsSync.unlink(LOCAL_MODEL_PATH, () => {});
        reject(new Error("Too many redirects downloading model"));
        return;
      }

      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // drain and release the socket
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          file.destroy();
          fsSync.unlink(LOCAL_MODEL_PATH, () => {});
          reject(new Error(`Model download failed: HTTP ${res.statusCode}`));
          return;
        }

        const total = parseInt(res.headers["content-length"] ?? "0", 10);
        let received = 0;

        res.on("data", (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.round((received / total) * 100);
            const receivedMb = Math.round(received / 1024 / 1024);
            const totalMb = Math.round(total / 1024 / 1024);
            process.stdout.write(`\rDownloading ${LOCAL_MODEL_NAME} ... ${pct}% (${receivedMb} MB / ${totalMb} MB)`);
          }
        });

        res.pipe(file);

        file.on("finish", () => {
          file.close();
          process.stdout.write("\n");
          resolve();
        });
      }).on("error", (err) => {
        file.destroy();
        fsSync.unlink(LOCAL_MODEL_PATH, () => {});
        reject(err);
      });
    }

    doRequest(LOCAL_MODEL_URL);
  });
}

async function ensureLocalModel(log) {
  if (await fileExists(LOCAL_MODEL_PATH)) {
    return true; // already cached
  }

  log(`Downloading local model to ${LOCAL_MODEL_PATH} ...`);
  try {
    await downloadModel(log);
    log(`✅ Model cached at ${LOCAL_MODEL_PATH}`);
    return true;
  } catch (err) {
    log(`⚠️  Model download failed: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// runtime.js content builders
// ---------------------------------------------------------------------------

function buildLocalRuntime() {
  return `import { createDefaultRuntime } from "runeflow";
import { getLlama, LlamaChatSession } from "node-llama-cpp";
import path from "node:path";
import os from "node:os";

const modelPath = path.join(os.homedir(), ".runeflow", "models", "qwen2.5-0.5b-instruct-q4_k_m.gguf");

async function localHandler({ prompt, schema }) {
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext();
  const session = new LlamaChatSession({ contextSequence: context.getSequence() });
  const response = await session.prompt(prompt);
  return JSON.parse(response);
}

const base = createDefaultRuntime();
export default { ...base, llms: { ...base.llms, local: localHandler } };
`;
}

function buildPlaceholderRuntime() {
  return `import { createDefaultRuntime } from "runeflow";

// TODO: Configure your LLM provider
// Install: npm install @ai-sdk/cerebras (or your preferred provider)
// Set: CEREBRAS_API_KEY=your-key (or equivalent)

export default createDefaultRuntime();
`;
}

// ---------------------------------------------------------------------------
// Extract skill name from generated .runeflow.md frontmatter
// ---------------------------------------------------------------------------

function extractSkillNameFromContent(content) {
  const match = content.match(/^---\n[\s\S]*?^name:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Conversion_Mode
// ---------------------------------------------------------------------------

async function runConversionMode(signals, options, { provider, model, isCloud, isTTY, log, cwd }) {
  const { claudeSkillFiles } = signals;
  const { noPolish, force } = options;

  let filesToConvert = claudeSkillFiles;

  if (isTTY && claudeSkillFiles.length > 0) {
    log("\nDetected Claude skill files:");
    claudeSkillFiles.forEach((f, i) => {
      log(`  ${i + 1}. ${f.relativePath} — ${f.title}`);
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await ask(
        rl,
        `\nWhich files to convert? (comma-separated numbers, or press Enter for all)`,
      );

      if (answer.trim()) {
        const indices = answer.split(",").map((s) => parseInt(s.trim(), 10) - 1).filter((i) => i >= 0 && i < claudeSkillFiles.length);
        if (indices.length > 0) {
          filesToConvert = indices.map((i) => claudeSkillFiles[i]);
        }
      }
    } finally {
      rl.close();
    }
  }

  const writtenPaths = [];
  const summaryLines = [];

  for (const skillFile of filesToConvert) {
    const source = await fs.readFile(skillFile.path, "utf8").catch(() => null);
    if (source === null) {
      log(`⚠️  Could not read ${skillFile.relativePath} — skipping`);
      continue;
    }

    const result = convertClaudeSkill(source, {
      sourcePath: skillFile.relativePath,
      provider,
      model,
    });

    let content = result.output;

    // Optionally polish
    content = await tryPolish(content, { provider, model, isCloud, noPolish, log });

    // Determine output filename
    const baseName = path.basename(skillFile.path, ".md");
    const outFile = path.join(cwd, `${baseName}.runeflow.md`);

    if (await fileExists(outFile) && !force) {
      throw new Error(`${path.basename(outFile)} already exists. Use --force to overwrite.`);
    }

    await fs.writeFile(outFile, content, "utf8");
    writtenPaths.push(outFile);
    log(`✅ Created ${outFile}`);

    const warningNote = result.warnings.length > 0
      ? ` (${result.warnings.length} warning(s) — manual attention needed)`
      : "";
    summaryLines.push(`  ${skillFile.relativePath} → ${path.basename(outFile)}${warningNote}`);

    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        log(`  ⚠️  ${w}`);
      }
    }
  }

  log("\n📋 Conversion summary:");
  for (const line of summaryLines) {
    log(line);
  }

  return writtenPaths;
}

// ---------------------------------------------------------------------------
// Generation_Mode
// ---------------------------------------------------------------------------

async function runGenerationMode(signals, options, { provider, model, isCloud, isTTY, log, cwd }) {
  const { noPolish, force } = options;

  // Select template
  let selection = selectTemplate(signals, { forceTemplate: options.template });

  log(`📋 Template: ${selection.templateId}`);

  // Clarifying question if not confident and TTY
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

  // Generate skill content
  let content = template.generate(signals, { provider, model, name: options.name });

  // Optionally polish
  content = await tryPolish(content, { provider, model, isCloud, noPolish, log });

  // Derive skill filename from frontmatter name
  const skillName = options.name
    ? slugify(options.name)
    : (extractSkillNameFromContent(content) ?? slugify(selection.templateId));

  const skillFile = path.join(cwd, `${skillName}.runeflow.md`);
  const runtimeFile = path.join(cwd, "runtime.js");

  if (await fileExists(skillFile) && !force) {
    throw new Error(`${path.basename(skillFile)} already exists. Use --force to overwrite.`);
  }

  await fs.writeFile(skillFile, content, "utf8");
  log(`✅ Created ${skillFile}`);

  // Write runtime.js — use local handler only when the local model is actually in use
  const runtimeExists = await fileExists(runtimeFile);
  if (!runtimeExists || force) {
    const runtimeContent = provider === "local" ? buildLocalRuntime() : buildPlaceholderRuntime();
    await fs.writeFile(runtimeFile, runtimeContent, "utf8");
    log(`✅ Created ${runtimeFile}`);
  }

  // Print ready-to-run command
  log(`\nruneflow run ./${path.basename(skillFile)} --input '{}' --runtime ./runtime.js`);

  return [skillFile, ...(!runtimeExists || force ? [runtimeFile] : [])];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function runInit(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const isTTY = process.stdin.isTTY && process.stdout.isTTY;
  const log = options.silent ? () => {} : (...args) => console.log(...args);

  // Step 1: Inspect repo
  const signals = await inspectRepo({
    cwd,
    extraContext: options.context ? [options.context] : [],
  });

  // Step 2: Resolve provider/model
  let { provider, model, isCloud } = resolveProvider(options);

  // Handle local LLM path
  if (provider === "local") {
    if (options.noLocalLlm) {
      // Use placeholder directly
      provider = "placeholder";
      model = "placeholder";
      isCloud = false;
    } else {
      // Try to ensure local model is available
      const modelReady = await ensureLocalModel(log);
      if (!modelReady) {
        log("⚠️  Falling back to placeholder provider.");
        provider = "placeholder";
        model = "placeholder";
        isCloud = false;
      } else {
        log(`Model: ${LOCAL_MODEL_NAME}`);
        log(`Cache: ${LOCAL_MODEL_PATH}`);
      }
    }
  }

  const ctx = { provider, model, isCloud, isTTY, log, cwd };

  // Step 3a or 3b
  if (signals.claudeSkillFiles.length > 0) {
    return runConversionMode(signals, options, ctx);
  } else {
    return runGenerationMode(signals, options, ctx);
  }
}
