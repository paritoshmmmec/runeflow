import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectRepo } from "../src/init-inspector.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "runeflow-test-"));
}

// 1. SDK detection from package.json dependencies and devDependencies
test("detects integrations from package.json deps and devDeps", async () => {
  const dir = await makeTmpDir();
  try {
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "test-repo",
        dependencies: { stripe: "^12.0.0" },
        devDependencies: { "@slack/web-api": "^7.0.0" },
      }),
    );
    const result = await inspectRepo({ cwd: dir });
    assert.ok(result.integrations.includes("stripe"), "should detect stripe");
    assert.ok(result.integrations.includes("slack"), "should detect slack");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// 2. Graceful skip of missing/unreadable sources
test("returns sensible defaults for an empty directory", async () => {
  const dir = await makeTmpDir();
  try {
    const result = await inspectRepo({ cwd: dir });
    assert.ok(Array.isArray(result.integrations), "integrations should be array");
    assert.equal(result.integrations.length, 0);
    assert.ok(Array.isArray(result.gitCommits), "gitCommits should be array");
    assert.ok(Array.isArray(result.scripts), "scripts should be array");
    assert.ok(Array.isArray(result.existingSkillNames));
    assert.ok(Array.isArray(result.existingSkillTools));
    assert.ok(Array.isArray(result.claudeSkillFiles));
    assert.equal(result.packageManager, "none");
    assert.equal(result.ciProvider, "none");
    assert.equal(result.primaryLanguage, "unknown");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// 3. Non-git directory sets gitCommits: []
test("sets gitCommits to empty array for non-git directory", async () => {
  const dir = await makeTmpDir();
  try {
    const result = await inspectRepo({ cwd: dir });
    assert.deepEqual(result.gitCommits, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// 4. extraContext pass-through
test("passes extraContext through to signals", async () => {
  const dir = await makeTmpDir();
  try {
    const extra = ["deploy to AWS", "use stripe"];
    const result = await inspectRepo({ cwd: dir, extraContext: extra });
    assert.deepEqual(result.extraContext, extra);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// 5. Claude skill file detection — detects files with markers
test("detects .md files containing <system> block as claude skill files", async () => {
  const dir = await makeTmpDir();
  try {
    await fs.writeFile(
      path.join(dir, "my-skill.md"),
      "# My Skill\n\n<system>\nYou are a helpful assistant.\n</system>\n",
    );
    const result = await inspectRepo({ cwd: dir });
    assert.equal(result.claudeSkillFiles.length, 1);
    assert.equal(result.claudeSkillFiles[0].relativePath, "my-skill.md");
    assert.ok(result.claudeSkillFiles[0].markers.includes("system-block"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// 6. Claude skill file detection — ignores runeflow workflow files
test("ignores runeflow workflow files when scanning for claude skill files", async () => {
  const dir = await makeTmpDir();
  try {
    await fs.writeFile(
      path.join(dir, "my-skill.md"),
      "---\nruneflow: true\n---\n\n# My Skill\n\n<system>\nYou are a helpful assistant.\n</system>\n",
    );
    const result = await inspectRepo({ cwd: dir });
    assert.equal(result.claudeSkillFiles.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// 7. Existing .md skill names are extracted
test("extracts skill names from .md frontmatter", async () => {
  const dir = await makeTmpDir();
  try {
    await fs.writeFile(
      path.join(dir, "my-skill.md"),
      "---\nname: my-skill\ndescription: A test skill\n---\n\n# My Skill\n",
    );
    const result = await inspectRepo({ cwd: dir });
    assert.ok(result.existingSkillNames.includes("my-skill"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// 8. Existing .md tool names are extracted
test("extracts tool names from .md content", async () => {
  const dir = await makeTmpDir();
  try {
    await fs.writeFile(
      path.join(dir, "push.md"),
      "---\nname: push\ndescription: Push skill\n---\n\n```runeflow\nstep push type=tool {\n  tool: git.push_current_branch\n  out: { ok: boolean }\n}\noutput {}\n```\n",
    );
    const result = await inspectRepo({ cwd: dir });
    assert.ok(result.existingSkillTools.includes("git.push_current_branch"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
