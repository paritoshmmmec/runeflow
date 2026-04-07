/**
 * runeflow init — interactive skill scaffolder.
 *
 * Asks a few questions and writes:
 *   <name>.runeflow.md   — the skill file
 *   runtime.js           — a minimal runtime wired to the chosen provider
 */

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const PROVIDER_DEFAULTS = {
  cerebras: { model: "qwen-3-235b-a22b-instruct-2507", envKey: "CEREBRAS_API_KEY", pkg: "@ai-sdk/cerebras" },
  openai:   { model: "gpt-4o",                         envKey: "OPENAI_API_KEY",   pkg: "@ai-sdk/openai" },
  anthropic: { model: "claude-3-7-sonnet-latest",      envKey: "ANTHROPIC_API_KEY", pkg: "@ai-sdk/anthropic" },
  groq:     { model: "llama-3.3-70b-versatile",        envKey: "GROQ_API_KEY",     pkg: "@ai-sdk/groq" },
  mistral:  { model: "mistral-large-latest",           envKey: "MISTRAL_API_KEY",  pkg: "@ai-sdk/mistral" },
  google:   { model: "gemini-2.0-flash",               envKey: "GOOGLE_GENERATIVE_AI_API_KEY", pkg: "@ai-sdk/google" },
};

function ask(rl, question, defaultValue) {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildSkillFile({ name, description, provider, model }) {
  const slug = slugify(name);
  return `---
name: ${slug}
description: ${description}
version: 0.1
inputs:
  # add your inputs here
  # example: base_branch: string
outputs:
  result: string
llm:
  provider: ${provider}
  model: ${model}
---

# ${name}

${description}

\`\`\`runeflow
step run type=llm {
  prompt: "Complete the task described in the operator notes."
  input: {}
  schema: { result: string }
}

output {
  result: steps.run.result
}
\`\`\`
`;
}

function buildRuntimeFile({ provider, envKey, pkg }) {
  return `import { createDefaultRuntime } from "runeflow";

// Requires: ${envKey}
// Install:  npm install ${pkg}

export default createDefaultRuntime();
`;
}

export async function runInit(options = {}) {
  const isTTY = process.stdin.isTTY;

  // Non-interactive mode — use provided options or fail
  if (!isTTY && !options.name) {
    throw new Error(
      "runeflow init requires an interactive terminal or --name, --description, --provider flags.",
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("\n⚡ runeflow init\n");

    const name = options.name ?? await ask(rl, "Skill name", "my-skill");
    const description = options.description ?? await ask(rl, "What does it do", `${name} skill`);
    const providerInput = options.provider ?? await ask(rl, `Provider (${Object.keys(PROVIDER_DEFAULTS).join(", ")})`, "cerebras");
    const provider = PROVIDER_DEFAULTS[providerInput] ? providerInput : "cerebras";
    const providerConfig = PROVIDER_DEFAULTS[provider];
    const model = options.model ?? await ask(rl, "Model", providerConfig.model);

    const slug = slugify(name);
    const skillFile = `${slug}.runeflow.md`;
    const runtimeFile = "runtime.js";
    const cwd = options.cwd ?? process.cwd();

    const skillPath = path.join(cwd, skillFile);
    const runtimePath = path.join(cwd, runtimeFile);

    // Check for existing files
    const skillExists = await fs.access(skillPath).then(() => true).catch(() => false);
    const runtimeExists = await fs.access(runtimePath).then(() => true).catch(() => false);

    if (skillExists && !options.force) {
      throw new Error(`${skillFile} already exists. Use --force to overwrite.`);
    }

    await fs.writeFile(skillPath, buildSkillFile({ name, description, provider, model }));

    if (!runtimeExists || options.force) {
      await fs.writeFile(runtimePath, buildRuntimeFile({ provider, envKey: providerConfig.envKey, pkg: providerConfig.pkg }));
    }

    console.log(`\n✅ Created ${skillFile}`);
    if (!runtimeExists || options.force) console.log(`✅ Created ${runtimeFile}`);
    console.log(`\nNext steps:`);
    console.log(`  1. npm install ${providerConfig.pkg}`);
    console.log(`  2. export ${providerConfig.envKey}=your-key`);
    console.log(`  3. Edit ${skillFile} to define your workflow`);
    console.log(`  4. runeflow validate ./${skillFile}`);
    console.log(`  5. runeflow run ./${skillFile} --input '{}' --runtime ./${runtimeFile}\n`);

  } finally {
    rl.close();
  }
}
