import { slugify } from "../init-utils.js";

export const template = {
  id: "generic-llm-task",
  description: "Generic LLM task with configurable prompt",
  signals: {
    keywords: [{ value: "task", weight: 1 }],
  },
  generate(signals, options = {}) {
    const provider = options.provider ?? "cerebras";
    const model = options.model ?? "qwen-3-235b-a22b-instruct-2507";
    const repoSlug = signals.repoName ? slugify(signals.repoName) + "-" : "";
    const skillName = options.name ?? `${repoSlug}llm-task`;
    const repoName = signals.repoName ?? "a software project";

    return `---
name: ${skillName}
description: A structured LLM task — edit the prompt and schema to suit your use case.
version: 0.1
inputs:
  context: string
outputs:
  result: string
  reasoning: string
llm:
  provider: ${provider}
  router: false
  model: ${model}
---

# LLM Task

Edit the prompt below to describe what you want the model to do.
The \`context\` input is passed in at runtime — replace it with whatever
data your workflow needs (a diff, a document, a list of items, etc.).

\`\`\`runeflow
step run type=llm {
  prompt: |
    You are a helpful assistant working on ${repoName}.

    Context:
    {{ inputs.context }}

    Complete the task above. Be concise and specific.
  input: { context: inputs.context }
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
