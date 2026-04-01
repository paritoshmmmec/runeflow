import YAML from "yaml";
import path from "node:path";
import { parseSkill } from "./parser.js";

function slugifyName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function importMarkdownSkill(source, options = {}) {
  const parsed = parseSkill(source, options);
  const fileName = options.sourcePath ? path.basename(options.sourcePath, path.extname(options.sourcePath)) : "imported-skill";
  const name = parsed.metadata.name ?? slugifyName(fileName);
  const description = parsed.metadata.description ?? "Imported markdown runeflow. Add executable workflow steps manually.";
  const docs = parsed.docs || source.trim();
  const frontmatter = YAML.stringify({
    name,
    description,
    version: 0.1,
    inputs: {},
    outputs: {},
  }).trimEnd();

  return `---
${frontmatter}
---

${docs}

\`\`\`runeflow
step todo type=tool {
  tool: replace.me
  with: {}
  out: { result: string }
  next: fail
  fail_message: "Replace the placeholder workflow with real steps."
}

output {
}
\`\`\`
`;
}

export const importMarkdownRuneflow = importMarkdownSkill;
