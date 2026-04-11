function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const template = {
  id: "linear-issue",
  description: "Create or update a Linear issue",
  signals: {
    integrations: [{ value: "linear", weight: 60 }],
    keywords: [
      { value: "issue", weight: 15 },
      { value: "linear", weight: 20 },
      { value: "ticket", weight: 10 },
    ],
  },
  generate(signals, options = {}) {
    const provider = options.provider ?? "cerebras";
    const model = options.model ?? "qwen-3-235b-a22b-instruct-2507";
    const repoSlug = signals.repoName ? slugify(signals.repoName) + "-" : "";
    const skillName = options.name ?? `${repoSlug}linear-issue`;

    return `---
name: ${skillName}
description: Draft and create a Linear issue.
version: 0.1
inputs:
  title: string
  context: string
outputs:
  result: string
llm:
  provider: ${provider}
  router: false
  model: ${model}
---

# Linear Issue

Draft and create a Linear issue from the provided context.

\`\`\`runeflow
step draft type=llm {
  prompt: |
    Draft a Linear issue for: {{ inputs.title }}

    Context:
    {{ inputs.context }}

    Write a clear title and description suitable for an engineering team.
  schema: { title: string, description: string }
}

step done type=tool {
  tool: util.complete
  with: { result: steps.draft.description }
  out: { result: string }
}

output {
  result: steps.done.result
}
\`\`\`
`;
  },
};
