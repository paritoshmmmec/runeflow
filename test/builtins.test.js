import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { parseRuneflow } from "../src/parser.js";
import { runRuneflow } from "../src/runtime.js";

const execFileAsync = promisify(execFile);

async function runGit(args, cwd, options = {}) {
  await execFileAsync("git", args, { cwd, ...options });
}

async function createTempRepo(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const repoDir = path.join(rootDir, "repo");
  const remoteDir = path.join(rootDir, "remote.git");

  await fs.mkdir(repoDir, { recursive: true });
  await runGit(["init", "-b", "main"], repoDir);
  await runGit(["config", "user.name", "Runeflow Test"], repoDir);
  await runGit(["config", "user.email", "runeflow@example.test"], repoDir);
  await fs.writeFile(path.join(repoDir, "README.md"), "# Runeflow\n");
  await runGit(["add", "README.md"], repoDir);
  await runGit(["commit", "-m", "Initial commit"], repoDir);
  await runGit(["checkout", "-b", "feature/runeflow"], repoDir);
  await fs.writeFile(path.join(repoDir, "feature.txt"), "planned change\n");
  await runGit(["add", "feature.txt"], repoDir);
  await runGit(["commit", "-m", "Feature change"], repoDir);

  await runGit(["init", "--bare", remoteDir], repoDir);
  await runGit(["remote", "add", "origin", remoteDir], repoDir);

  return { repoDir, remoteDir };
}

test("runRuneflow built-ins expose current branch and diff summary", async () => {
  const { repoDir } = await createTempRepo("runeflow-builtins-");
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: repo-summary
description: Repo summary
version: 0.1
inputs:
  base_branch: string
outputs:
  branch: string
  summary: string
  files:
    - string
---

\`\`\`runeflow
step current_branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step summarize_diff type=tool {
  tool: git.diff_summary
  with: { base: inputs.base_branch }
  out: { base: string, summary: string, files: [string] }
}

step finish type=tool {
  tool: util.complete
  with: {
    branch: steps.current_branch.branch,
    summary: steps.summarize_diff.summary,
    files: "{{ steps.summarize_diff.files }}"
  }
  out: { branch: string, summary: string, files: [string] }
}

output {
  branch: steps.finish.branch
  summary: steps.finish.summary
  files: steps.finish.files
}
\`\`\`
`);

  const run = await runRuneflow(parsed, { base_branch: "main" }, {}, { runsDir, cwd: repoDir });

  assert.equal(run.status, "success");
  assert.equal(run.outputs.branch, "feature/runeflow");
  assert.match(run.outputs.summary, /feature\.txt/);
  assert.deepEqual(run.outputs.files, ["feature.txt"]);
});

test("runRuneflow built-in push_current_branch pushes to the local remote", async () => {
  const { repoDir, remoteDir } = await createTempRepo("runeflow-push-");
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: push-branch
description: Push branch
version: 0.1
inputs: {}
outputs:
  branch: string
  remote: string
---

\`\`\`runeflow
step push type=tool {
  tool: git.push_current_branch
  out: { branch: string, remote: string }
}

output {
  branch: steps.push.branch
  remote: steps.push.remote
}
\`\`\`
`);

  const run = await runRuneflow(parsed, {}, {}, { runsDir, cwd: repoDir });

  assert.equal(run.status, "success");
  assert.deepEqual(run.outputs, {
    branch: "feature/runeflow",
    remote: "origin",
  });

  await runGit(["--git-dir", remoteDir, "rev-parse", "--verify", "refs/heads/feature/runeflow"], repoDir);
});
