function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const template = {
  id: "deploy",
  description: "Deploy to a cloud target",
  signals: {
    scripts: [{ value: "deploy", weight: 40 }, { value: "build", weight: 20 }],
    keywords: [{ value: "deploy", weight: 20 }, { value: "production", weight: 15 }],
  },
  generate(signals, options = {}) {
    const provider = options.provider ?? "cerebras";
    const model = options.model ?? "qwen-3-235b-a22b-instruct-2507";
    const repoSlug = signals.repoName ? slugify(signals.repoName) + "-" : "";
    const skillName = options.name ?? `${repoSlug}deploy`;

    const scripts = signals.scripts ?? [];
    const buildScript = scripts.find((s) => s === "build") ?? "build";
    const deployScript = scripts.find((s) => s === "deploy") ?? "deploy";

    return `---
name: ${skillName}
description: Build and deploy to a cloud target.
version: 0.1
inputs:
  environment: string
outputs:
  status: string
llm:
  provider: ${provider}
  router: false
  model: ${model}
---

# Deploy

Build the project and deploy to the target environment.

\`\`\`runeflow
step build type=cli {
  command: "npm run ${buildScript}"
}

step deploy type=cli {
  command: "npm run ${deployScript}"
}

step summarize type=llm {
  prompt: |
    Summarize the deployment to {{ inputs.environment }}.

    Build output:
    {{ steps.build.stdout }}
    Build exit code: {{ steps.build.exit_code }}

    Deploy output:
    {{ steps.deploy.stdout }}
    Deploy exit code: {{ steps.deploy.exit_code }}
  schema: { status: string }
}

step finish type=tool {
  tool: util.complete
  with: { status: steps.summarize.status }
  out: { status: string }
}

output {
  status: steps.finish.status
}
\`\`\`
`;
  },
};
