import { commandForPackageScript } from "../init-utils.js";
import { buildFrontmatter, defaultSkillName } from "./helpers.js";

export const template = {
  id: "deploy",
  description: "Deploy to a cloud target",
  signals: {
    scripts: [{ value: "deploy", weight: 40 }, { value: "build", weight: 20 }],
    keywords: [{ value: "deploy", weight: 20 }, { value: "production", weight: 15 }],
  },
  generate(signals, options = {}) {
    const skillName = defaultSkillName("deploy", options);

    const scripts = signals.scripts ?? [];
    const buildScript = scripts.find((s) => s === "build") ?? "build";
    const deployScript = scripts.find((s) => s === "deploy") ?? "deploy";
    const packageManager = signals.packageManager ?? "npm";

    const frontmatter = buildFrontmatter({
      name: skillName,
      description: "Build the project, run the deploy command, and summarize the outcome.",
      inputs: { environment: "string" },
      outputs: {
        summary: "string",
        build_exit_code: "number",
        deploy_exit_code: "number",
      },
      llmConfig: options.llmConfig,
    });

    return `${frontmatter}

# Deploy

Run the repo's build and deploy scripts, then summarize what happened. The CLI
steps intentionally allow failure so the final LLM step can explain both
successes and failures without losing the command output.

\`\`\`runeflow
step build type=cli allow_failure=true {
  command: "${commandForPackageScript(packageManager, buildScript)}"
}

step deploy type=cli allow_failure=true {
  command: "${commandForPackageScript(packageManager, deployScript)}"
}

step summarize type=llm {
  prompt: |
    Summarize the deployment to {{ inputs.environment }}.
    Call out whether the build or deploy command failed.

    Build output:
    {{ steps.build.stdout }}
    Build exit code: {{ steps.build.exit_code }}

    Deploy output:
    {{ steps.deploy.stdout }}
    Deploy exit code: {{ steps.deploy.exit_code }}
  schema: { summary: string }
}

output {
  summary: steps.summarize.summary
  build_exit_code: steps.build.exit_code
  deploy_exit_code: steps.deploy.exit_code
}
\`\`\`
`;
  },
};
