import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RuntimeError } from "./errors.js";

const execFileAsync = promisify(execFile);

async function runGit(args, cwd) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim();
  } catch (error) {
    const stderr = error?.stderr?.trim();
    const message = stderr || error.message;
    throw new RuntimeError(`git ${args.join(" ")} failed: ${message}`);
  }
}

async function getCurrentBranch(cwd) {
  const branch = await runGit(["branch", "--show-current"], cwd);

  if (!branch) {
    throw new RuntimeError("git.current_branch requires an attached HEAD.");
  }

  return branch;
}

async function getRemoteName(branch, cwd) {
  const remote = await runGit(["config", `branch.${branch}.remote`], cwd).catch(() => "");
  return remote || "origin";
}

async function ensureRemoteExists(remote, cwd) {
  const remotes = await runGit(["remote"], cwd);
  const remoteSet = new Set(remotes.split("\n").map((line) => line.trim()).filter(Boolean));

  if (!remoteSet.has(remote)) {
    throw new RuntimeError(`git.push_current_branch requires remote '${remote}' to exist.`);
  }
}

export function createBuiltinTools(options = {}) {
  const cwd = options.cwd ?? process.cwd();

  return {
    "file.exists": async ({ path: targetPath }) => {
      const absolutePath = path.resolve(cwd, targetPath);

      try {
        await fs.access(absolutePath);
        return { exists: true };
      } catch (error) {
        if (error?.code === "ENOENT") {
          return { exists: false };
        }

        throw new RuntimeError(`file.exists failed for '${targetPath}': ${error.message}`);
      }
    },

    "git.current_branch": async () => {
      const branch = await getCurrentBranch(cwd);
      return { branch };
    },

    "git.diff_summary": async ({ base }) => {
      if (!base) {
        throw new RuntimeError("git.diff_summary requires a base ref.");
      }

      await runGit(["rev-parse", "--verify", `${base}^{commit}`], cwd);
      const range = `${base}...HEAD`;
      const filesOutput = await runGit(["diff", "--name-only", range], cwd);
      const summaryOutput = await runGit(["diff", "--stat", range], cwd);

      return {
        base,
        summary: summaryOutput || "No changes.",
        files: filesOutput ? filesOutput.split("\n").map((line) => line.trim()).filter(Boolean) : [],
      };
    },

    "git.push_current_branch": async () => {
      const branch = await getCurrentBranch(cwd);
      const remote = await getRemoteName(branch, cwd);
      await ensureRemoteExists(remote, cwd);
      await runGit(["push", "-u", remote, branch], cwd);
      return { branch, remote };
    },

    "util.fail": async ({ message }) => ({
      message,
    }),

    "util.complete": async (input) => input,
  };
}
