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

    "git.log": async ({ base, limit = 50 }) => {
      if (!base) {
        throw new RuntimeError("git.log requires a base ref.");
      }
      await runGit(["rev-parse", "--verify", `${base}^{commit}`], cwd);
      const format = "%H\x1f%s\x1f%an\x1f%ai";
      const output = await runGit(
        ["log", `${base}...HEAD`, `--format=${format}`, `--max-count=${limit}`],
        cwd,
      );
      const commits = output
        ? output.split("\n").filter(Boolean).map((line) => {
            const [hash, subject, author, date] = line.split("\x1f");
            return { hash, subject, author, date };
          })
        : [];
      return { base, commits, count: commits.length };
    },

    "git.tag_list": async ({ pattern = "" } = {}) => {
      const args = ["tag", "--sort=-version:refname"];
      if (pattern) args.push("--list", pattern);
      const output = await runGit(args, cwd);
      const tags = output ? output.split("\n").filter(Boolean) : [];
      return { tags, latest: tags[0] ?? null };
    },

    "file.read": async ({ path: targetPath, encoding = "utf8" }) => {
      const absolutePath = path.resolve(cwd, targetPath);
      try {
        const content = await fs.readFile(absolutePath, encoding);
        return { content, path: targetPath };
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new RuntimeError(`file.read: file not found '${targetPath}'`);
        }
        throw new RuntimeError(`file.read failed for '${targetPath}': ${error.message}`);
      }
    },

    "file.write": async ({ path: targetPath, content, append = false }) => {
      const absolutePath = path.resolve(cwd, targetPath);
      try {
        if (append) {
          await fs.appendFile(absolutePath, content, "utf8");
        } else {
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
          await fs.writeFile(absolutePath, content, "utf8");
        }
        return { path: targetPath, written: true };
      } catch (error) {
        throw new RuntimeError(`file.write failed for '${targetPath}': ${error.message}`);
      }
    },

    "util.fail": async ({ message }) => ({
      message,
    }),

    "util.complete": async (input) => input,
  };
}
