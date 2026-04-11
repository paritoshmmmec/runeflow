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

    return `---
name: ${skillName}
description: Generic LLM task — edit the prompt to suit your use case.
version: 0.1
inputs:
  task: string
outputs:
  result: string
llm:
  provider: ${provider}
  router: false
  model: ${model}
---

# LLM Task

A generic LLM task. Edit the prompt below to suit your use case.

\`\`\`runeflow
step run type=llm {
  prompt: |
    Complete the following task:
    {{ inputs.task }}
  schema: { result: string }
}

output {
  result: steps.run.result
}
\`\`\`
`;
  },
};
