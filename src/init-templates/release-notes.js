import { slugify } from "../init-utils.js";

export const template = {
  id: "release-notes",
  description: "Draft release notes from git log since last tag",
  signals: {
    scripts: [{ value: "release", weight: 30 }, { value: "version", weight: 20 }],
    keywords: [
      { value: "release", weight: 20 },
      { value: "tag", weight: 15 },
      { value: "changelog", weight: 15 },
    ],
  },
  generate(signals, options = {}) {
    const provider = options.provider ?? "cerebras";
    const model = options.model ?? "qwen-3-235b-a22b-instruct-2507";
    const repoSlug = signals.repoName ? slugify(signals.repoName) + "-" : "";
    const skillName = options.name ?? `${repoSlug}release-notes`;

    return `---
name: ${skillName}
description: Draft release notes from git log since the last tag.
version: 0.1
inputs:
  base_ref: string
outputs:
  title: string
  notes: string
llm:
  provider: ${provider}
  router: false
  model: ${model}
---

# Release Notes

Draft structured release notes from commits since the last git tag.

\`\`\`runeflow
step get_tags type=tool {
  tool: git.tag_list
  out: { tags: [string], latest: string }
}

step get_log type=tool {
  tool: git.log
  with: { base: inputs.base_ref }
  out: { base: string, commits: [any], count: number }
}

step draft type=llm {
  prompt: |
    Draft release notes since {{ inputs.base_ref }}.

    Latest tag: {{ steps.get_tags.latest }}

    Commits ({{ steps.get_log.count }} total):
    {{ steps.get_log.commits }}
  schema: { title: string, notes: string }
}

step finish type=tool {
  tool: util.complete
  with: {
    title: steps.draft.title,
    notes: steps.draft.notes
  }
  out: { title: string, notes: string }
}

output {
  title: steps.finish.title
  notes: steps.finish.notes
}
\`\`\`
`;
  },
};
