import { buildFrontmatter, defaultSkillName } from "./helpers.js";

export const template = {
  id: "open-pr",
  description: "Open a GitHub pull request from current branch",
  signals: {
    integrations: [{ value: "github", weight: 40 }],
    scripts: [{ value: "push", weight: 20 }],
    keywords: [{ value: "pr", weight: 15 }, { value: "pull request", weight: 15 }],
  },
  generate(signals, options = {}) {
    const skillName = defaultSkillName("open-pr", options);

    const frontmatter = buildFrontmatter({
      name: skillName,
      description: "Draft a GitHub pull request from the current branch.",
      inputs: { base_branch: "string" },
      outputs: {
        branch: "string",
        title: "string",
        body: "string",
        diff_summary: "string",
      },
      llmConfig: options.llmConfig,
    });

    return `${frontmatter}

# Draft Pull Request

Use the current branch name and a diff summary to draft a title and body that
are ready to paste into GitHub. Keep the output tight, concrete, and grounded
in the diff instead of guessing at intent.

\`\`\`runeflow
step branch type=cli {
  command: "git rev-parse --abbrev-ref HEAD"
}

step diff type=cli {
  command: "git diff --stat {{ inputs.base_branch }}...HEAD"
}

step draft type=llm {
  prompt: |
    Branch: {{ steps.branch.stdout }} -> {{ inputs.base_branch }}

    Diff summary:
    {{ steps.diff.stdout }}

    Draft a PR title under 72 characters that starts with feat:, fix:, chore:,
    docs:, refactor:, or test:. Then write a plain-Markdown body covering what
    changed and why.
  schema: { title: string, body: string }
}

output {
  branch: steps.branch.stdout
  title: steps.draft.title
  body: steps.draft.body
  diff_summary: steps.diff.stdout
}
\`\`\`
`;
  },
};
