import { buildFrontmatter, defaultSkillName } from "./helpers.js";

export const template = {
  id: "generic-llm-task",
  description: "Generic LLM task with configurable prompt",
  signals: {
    keywords: [{ value: "task", weight: 1 }],
  },
  generate(signals, options = {}) {
    const skillName = defaultSkillName("llm-task", options);
    const repoName = signals.repoName ?? "a software project";

    const frontmatter = buildFrontmatter({
      name: skillName,
      description: "A structured LLM task. Edit the prompt, inputs, and schema to fit your workflow.",
      inputs: { context: "string" },
      outputs: { result: "string", reasoning: "string" },
      llmConfig: options.llmConfig,
    });

    return `${frontmatter}

# LLM Task

Edit the prompt below to describe what you want the model to do.
The \`context\` input is passed in at runtime. Replace it with whatever
data your workflow needs (a diff, a document, a list of items, etc.).

\`\`\`runeflow
step run type=llm {
  prompt: |
    You are a helpful assistant working on ${repoName}.

    Context:
    {{ inputs.context }}

    Complete the task described above. Be concise, specific, and structured.
  schema: { result: string, reasoning: string }
}

output {
  result: steps.run.result
  reasoning: steps.run.reasoning
}
\`\`\`
`;
  },
};
