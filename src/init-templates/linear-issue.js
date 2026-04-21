import { buildFrontmatter, defaultSkillName } from "./helpers.js";

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
    const skillName = defaultSkillName("linear-issue", options);

    const frontmatter = buildFrontmatter({
      name: skillName,
      description: "Draft a Linear issue title and description from local context.",
      inputs: { title: "string", context: "string" },
      outputs: { title: "string", description: "string" },
      llmConfig: options.llmConfig,
    });

    return `${frontmatter}

# Linear Issue

Draft a clean engineering issue from the supplied title and context. Keep the
result ready to paste into Linear, but avoid inventing implementation details
that are not present in the input.

\`\`\`runeflow
step draft type=llm {
  prompt: |
    Draft a Linear issue for: {{ inputs.title }}

    Context:
    {{ inputs.context }}

    Write a concise title and a clear description suitable for an engineering team.
  schema: { title: string, description: string }
}

output {
  title: steps.draft.title
  description: steps.draft.description
}
\`\`\`
`;
  },
};
