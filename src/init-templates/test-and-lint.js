import { commandForPackageScript } from "../init-utils.js";
import { buildFrontmatter, defaultSkillName } from "./helpers.js";

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
    const skillName = defaultSkillName("test-and-lint", options);

    // Use actual script names from signals if available
    const scripts = signals.scripts ?? [];
    const testScript = scripts.find((s) => s === "test" || s === "tests") ?? "test";
    const lintScript = scripts.find((s) => s === "lint" || s === "eslint") ?? "lint";
    const packageManager = signals.packageManager ?? "npm";

    const frontmatter = buildFrontmatter({
      name: skillName,
      description: "Run the repo's test and lint scripts and summarize the results.",
      inputs: {},
      outputs: {
        summary: "string",
        test_exit_code: "number",
        lint_exit_code: "number",
      },
      llmConfig: options.llmConfig,
    });

    return `${frontmatter}

# Test and Lint

Run the test suite and linter, then produce a concise summary. The CLI steps
allow failure so the workflow can still collect output and explain what broke.

\`\`\`runeflow
step run_tests type=cli allow_failure=true {
  command: "${commandForPackageScript(packageManager, testScript)}"
}

step run_lint type=cli allow_failure=true {
  command: "${commandForPackageScript(packageManager, lintScript)}"
}

step summarize type=llm {
  prompt: |
    Summarize the test and lint results.
    Call out any failures first, then the most important clean signals.

    Test output:
    {{ steps.run_tests.stdout }}
    Exit code: {{ steps.run_tests.exit_code }}

    Lint output:
    {{ steps.run_lint.stdout }}
    Exit code: {{ steps.run_lint.exit_code }}
  schema: { summary: string }
}

output {
  summary: steps.summarize.summary
  test_exit_code: steps.run_tests.exit_code
  lint_exit_code: steps.run_lint.exit_code
}
\`\`\`
`;
  },
};
