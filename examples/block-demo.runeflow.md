---
name: block-demo
description: Demonstrate a reusable block referenced by a step.
version: 0.1
inputs:
  name: string
outputs:
  greeting: string
llm:
  provider: mock
  router: false
  model: demo
---

# Block demo

The `greet_template` block holds the full LLM contract; the step only names it and wires the workflow id.

```runeflow
block greet_template type=llm {
  prompt: "Reply with a single short greeting for {{ inputs.name }}."
  schema: { greeting: string }
}

step greet type=block {
  block: greet_template
}

output {
  greeting: steps.greet.greeting
}
```
