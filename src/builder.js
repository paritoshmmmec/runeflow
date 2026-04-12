import { runRuneflow } from "./runtime.js";

/**
 * Generates a .md file from an English description or JSON spec.
 *
 * @param {string} description - English description or JSON string
 * @param {object} options - { provider, model, apiKey, ... }
 * @returns {Promise<string>} - The generated .md content
 */
export async function buildRuneflow(description, options = {}) {
  const { provider, model } = options;

  if (!provider) {
    throw new Error("A provider is required for 'runeflow build'. Configure it in frontmatter or via options.");
  }

  const prompt = `
You are a Runeflow developer. Your task is to translate an English description of a workflow into a .md file.

Runeflow uses Markdown as its primary format. The frontmatter declares metadata, the prose is human-readable guidance, and a fenced \`runeflow\` block holds the executable workflow logic.
Available step kinds: tool, llm, transform, parallel, branch, human_input, fail.

Example:
Description: A .md that reads a file and summarizes it.
Result:
---
name: summarize-file
description: Reads a file and summarizes its content.
inputs:
  path: string
outputs:
  summary: string
llm:
  provider: openai
  model: gpt-4o
---
# Summarize File

\`\`\`runeflow
step read type=tool {
  tool: file.read
  with: { path: inputs.path }
  out: { content: string }
}

step summarize type=llm {
  prompt: "Summarize the following content:\\n\\n{{ steps.read.content }}"
  schema: { summary: string }
}

output {
  summary: steps.summarize.summary
}
\`\`\`

Common built-in tools:
- file.read { path: string } -> { content: string }
- file.write { path: string, content: string } -> { written: boolean }
- file.exists { path: string } -> { exists: boolean }
- git.current_branch {} -> { branch: string }
- git.diff_summary { base: string, head: string } -> { summary: string }

Now, translate the following description into a high-quality .md file.
Use the double-brace syntax for referencing step outputs, e.g., {{ steps.id.field }}.
Output ONLY the file content, no conversational filler.

Description: ${description}
`.trim();


  // We use the runtime's own LLM execution logic by creating a temporary skill
  const internalSkill = {
    metadata: {
      name: "runeflow-builder-internal",
      description: "Internal executor for runeflow build",
      inputs: { prompt: "string" },
      outputs: { skill: "string" },
      llm: { provider, model }
    },
    workflow: {
      steps: [
        {
          id: "generate",
          kind: "llm",
          prompt: "{{ inputs.prompt }}",
          schema: { skill: "string" }
        }
      ],
      output: {
        skill: "steps.generate.skill"
      }
    }
  };

  const run = await runRuneflow(internalSkill, { prompt }, options.runtime ?? {}, { ...options, checkAuth: true });

  if (run.status !== "success") {
    throw new Error(`Failed to build skill: ${run.error?.message || "Unknown error"}`);
  }

  return run.outputs.skill;
}
