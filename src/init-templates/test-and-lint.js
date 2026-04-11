import { slugify } from "../init-utils.js";

export const template = {
  id: "test-and-lint",
  description: "Run tests and linter, report results",
  signals: {
    scripts: [
      { value: "test", weight: 30 },
      { value: "lint", weight: 25 },
      { value: "check", weight: 15 },
    ],
  },
  generate(signals, options = {}) {
    const provider = options.provider ?? "cerebras";
    const model = options.model ?? "qwen-3-235b-a22b-instruct-2507";
    const repoSlug = signals.repoName ? slugify(signals.repoName) + "-" : "";
    const skillName = options.name ?? `${repoSlug}test-and-lint`;

    // Use actual script names from signals if available
    const scripts = signals.scripts ?? [];
    const testScript = scripts.find((s) => s === "test" || s === "tests") ?? "test";
    const lintScript = scripts.find((s) => s === "lint" || s === "eslint") ?? "lint";

    return `---
name: ${skillName}
description: Run tests and linter, then summarize results.
version: 0.1
inputs: {}
outputs:
  summary: string
llm:
  provider: ${provider}
  router: false
  model: ${model}
---

# Test and Lint

Run the test suite and linter, then produce a summary of results.

\`\`\`runeflow
step run_tests type=cli {
  command: "npm run ${testScript}"
}

step run_lint type=cli {
  command: "npm run ${lintScript}"
}

step summarize type=llm {
  prompt: |
    Summarize the test and lint results.

    Test output:
    {{ steps.run_tests.stdout }}
    Exit code: {{ steps.run_tests.exit_code }}

    Lint output:
    {{ steps.run_lint.stdout }}
    Exit code: {{ steps.run_lint.exit_code }}
  schema: { summary: string }
}

step finish type=tool {
  tool: util.complete
  with: { summary: steps.summarize.summary }
  out: { summary: string }
}

output {
  summary: steps.finish.summary
}
\`\`\`
`;
  },
};
