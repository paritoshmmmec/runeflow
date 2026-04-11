import { slugify } from "../init-utils.js";

export const template = {
  id: "notify-slack",
  description: "Post a message to a Slack channel",
  signals: {
    integrations: [{ value: "slack", weight: 60 }],
    keywords: [{ value: "notify", weight: 10 }, { value: "slack", weight: 20 }],
  },
  generate(signals, options = {}) {
    const provider = options.provider ?? "cerebras";
    const model = options.model ?? "qwen-3-235b-a22b-instruct-2507";
    const repoSlug = signals.repoName ? slugify(signals.repoName) + "-" : "";
    const skillName = options.name ?? `${repoSlug}notify-slack`;

    return `---
name: ${skillName}
description: Draft and post a message to a Slack channel.
version: 0.1
inputs:
  topic: string
  channel: string
outputs:
  result: string
llm:
  provider: ${provider}
  router: false
  model: ${model}
---

# Notify Slack

Draft a Slack message and post it to the specified channel.

\`\`\`runeflow
step draft type=llm {
  prompt: |
    Draft a concise Slack message about: {{ inputs.topic }}
    Keep it under 200 characters and suitable for channel {{ inputs.channel }}.
  schema: { message: string }
}

step done type=tool {
  tool: util.complete
  with: { result: steps.draft.message }
  out: { result: string }
}

output {
  result: steps.done.result
}
\`\`\`
`;
  },
};
