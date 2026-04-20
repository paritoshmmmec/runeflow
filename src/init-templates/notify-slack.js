import { buildFrontmatter, defaultSkillName } from "./helpers.js";

export const template = {
  id: "notify-slack",
  description: "Post a message to a Slack channel",
  signals: {
    integrations: [{ value: "slack", weight: 60 }],
    keywords: [{ value: "notify", weight: 10 }, { value: "slack", weight: 20 }],
  },
  generate(signals, options = {}) {
    const skillName = defaultSkillName("notify-slack", options);

    const frontmatter = buildFrontmatter({
      name: skillName,
      description: "Draft a Slack-ready message about a topic for a specific channel.",
      inputs: { topic: "string", channel: "string" },
      outputs: { message: "string" },
      llmConfig: options.llmConfig,
    });

    return `${frontmatter}

# Notify Slack

Draft a short Slack message that can be pasted into the target channel without
extra editing. Prefer concrete status and next-step language over hype.

\`\`\`runeflow
step draft type=llm {
  prompt: |
    Draft a concise Slack message about: {{ inputs.topic }}
    Keep it under 200 characters and suitable for channel {{ inputs.channel }}.
    Return plain text only.
  schema: { message: string }
}

output {
  message: steps.draft.message
}
\`\`\`
`;
  },
};
