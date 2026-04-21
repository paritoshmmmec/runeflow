import { buildFrontmatter, defaultSkillName } from "./helpers.js";

export const template = {
  id: "stripe-payment",
  description: "Create a Stripe payment intent or checkout session",
  signals: {
    integrations: [{ value: "stripe", weight: 60 }],
    keywords: [{ value: "payment", weight: 20 }, { value: "checkout", weight: 15 }],
  },
  generate(signals, options = {}) {
    const skillName = defaultSkillName("stripe-payment", options);

    const frontmatter = buildFrontmatter({
      name: skillName,
      description: "Draft a Stripe payment summary and payload shape from input values.",
      inputs: {
        amount: "number",
        currency: "string",
        description: "string",
      },
      outputs: {
        summary: "string",
        customer_message: "string",
      },
      llmConfig: options.llmConfig,
    });

    return `${frontmatter}

# Stripe Payment

Prepare a payment summary that can be reviewed before creating a Stripe payment
intent or checkout session. Keep the output concrete and customer-safe.

\`\`\`runeflow
step draft type=llm {
  prompt: |
    Prepare a Stripe payment intent for:
    Amount: {{ inputs.amount }} {{ inputs.currency }}
    Description: {{ inputs.description }}

    Summarize the payment details to confirm before processing and write a
    one-paragraph customer-facing message.
  schema: { summary: string, customer_message: string }
}

output {
  summary: steps.draft.summary
  customer_message: steps.draft.customer_message
}
\`\`\`
`;
  },
};
