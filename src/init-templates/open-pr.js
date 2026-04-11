import { slugify } from "../init-utils.js";

export const template = {
  id: "open-pr",
  description: "Open a GitHub pull request from current branch",
  signals: {
    integrations: [{ value: "github", weight: 40 }],
    scripts: [{ value: "push", weight: 20 }],
    keywords: [{ value: "pr", weight: 15 }, { value: "pull request", weight: 15 }],
  },
  generate(signals, options = {}) {
    const provider = options.provider ?? "cerebras";
    const model = options.model ?? "qwen-3-235b-a22b-instruct-2507";
    const skillName = options.name ?? (signals.repoName ? slugify(signals.repoName) + "-open-pr" : "open-pr");

    return `---
name: ${skillName}
description: Open a GitHub pull request from the current branch.
version: 0.1
inputs:
  base_branch: string
outputs:
  branch: string
  title: string
  body: string
llm:
  provider: ${provider}
  router: false
  model: ${model}
---

# Open Pull Request

Draft and open a pull request for the current branch.

\`\`\`runeflow
step get_branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step get_diff type=tool {
  tool: git.diff_summary
  with: { base: inputs.base_branch }
  out: { base: string, summary: string, files: [string] }
}

step draft type=llm {
  prompt: |
    Draft a pull request for branch {{ steps.get_branch.branch }} targeting {{ inputs.base_branch }}.

    Changed files:
    {{ steps.get_diff.files }}

    Diff summary:
    {{ steps.get_diff.summary }}
  input: {
    branch: steps.get_branch.branch,
    base_branch: inputs.base_branch,
    diff_summary: steps.get_diff.summary,
    changed_files: "{{ steps.get_diff.files }}"
  }
  schema: { title: string, body: string }
}

step push type=tool {
  tool: git.push_current_branch
  out: { branch: string, remote: string }
}

step finish type=tool {
  tool: util.complete
  with: {
    branch: steps.push.branch,
    title: steps.draft.title,
    body: steps.draft.body
  }
  out: { branch: string, title: string, body: string }
}

output {
  branch: steps.finish.branch
  title: steps.finish.title
  body: steps.finish.body
}
\`\`\`
`;
  },
};
