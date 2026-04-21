import { buildFrontmatter, defaultSkillName } from "./helpers.js";

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
    const skillName = defaultSkillName("release-notes", options);

    const frontmatter = buildFrontmatter({
      name: skillName,
      description: "Draft release notes from commits between a base ref and HEAD.",
      inputs: { base_ref: "string" },
      outputs: { title: "string", notes: "string" },
      llmConfig: options.llmConfig,
    });

    return `${frontmatter}

# Release Notes

Summarize the commit history between a base ref and HEAD into clean release
notes. The workflow grabs the latest tag for extra context but trusts the
requested \`base_ref\` as the source of truth for the range.

\`\`\`runeflow
step latest_tag type=cli allow_failure=true {
  command: "git describe --tags --abbrev=0"
}

step commits type=cli {
  command: "git log --oneline {{ inputs.base_ref }}..HEAD"
}

step draft type=llm {
  prompt: |
    Draft release notes since {{ inputs.base_ref }}.

    Latest tag:
    {{ steps.latest_tag.stdout }}

    Commits:
    {{ steps.commits.stdout }}
  schema: { title: string, notes: string }
}

output {
  title: steps.draft.title
  notes: steps.draft.notes
}
\`\`\`
`;
  },
};
