function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const template = {
  id: "stripe-payment",
  description: "Create a Stripe payment intent or checkout session",
  signals: {
    integrations: [{ value: "stripe", weight: 60 }],
    keywords: [{ value: "payment", weight: 20 }, { value: "checkout", weight: 15 }],
  },
  generate(signals, options = {}) {
    const provider = options.provider ?? "cerebras";
    const model = options.model ?? "qwen-3-235b-a22b-instruct-2507";
    const repoSlug = signals.repoName ? slugify(signals.repoName) + "-" : "";
    const skillName = options.name ?? `${repoSlug}stripe-payment`;

    return `---
name: ${skillName}
description: Prepare and create a Stripe payment intent or checkout session.
version: 0.1
inputs:
  amount: number
  currency: string
  description: string
outputs:
  result: string
llm:
  provider: ${provider}
  router: false
  model: ${model}
---

# Stripe Payment

Prepare payment details and create a Stripe payment intent.

\`\`\`runeflow
step draft type=llm {
  prompt: |
    Prepare a Stripe payment intent for:
    Amount: {{ inputs.amount }} {{ inputs.currency }}
    Description: {{ inputs.description }}

    Summarize the payment details to confirm before processing.
  schema: { summary: string }
}

step done type=tool {
  tool: util.complete
  with: { result: steps.draft.summary }
  out: { result: string }
}

output {
  result: steps.done.result
}
\`\`\`
`;
  },
};
