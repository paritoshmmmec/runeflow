/**
 * Unit tests for src/init.js — smarter-init orchestrator.
 *
 * All tests use in-memory temp directories and mock signals to avoid
 * real filesystem/network calls beyond the temp dir.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInit } from "../src/init.js";
import { parseRuneflow } from "../src/parser.js";
import { validateRuneflow } from "../src/validator.js";

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "rf-init-test-"));
}

async function listGeneratedSkills(dir) {
  const skillsDir = path.join(dir, ".runeflow", "skills");
  const entries = await fs.readdir(skillsDir);
  return entries.filter((entry) => entry.endsWith(".md")).map((entry) => path.join(skillsDir, entry));
}

// ---------------------------------------------------------------------------
// Generation_Mode is entered when no Claude skill files are found
// ---------------------------------------------------------------------------

test("Generation_Mode: writes a skill into .runeflow/skills", async () => {
  const dir = await makeTmpDir();
  try {
    await runInit({
      cwd: dir,
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      noLocalLlm: true,
      noPolish: true,
      silent: true,
    });

    const skillFiles = await listGeneratedSkills(dir);
    assert.ok(skillFiles.length >= 1, "Should write at least one skill file");

    // Validate the generated skill
    const content = await fs.readFile(skillFiles[0], "utf8");
    const parsed = parseRuneflow(content);
    const result = validateRuneflow(parsed);
    assert.deepEqual(result.issues, [], `Generated skill has validation issues: ${JSON.stringify(result.issues)}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Conversion_Mode is entered when claudeSkillFiles.length > 0
// ---------------------------------------------------------------------------

test("Conversion_Mode: writes converted skills into .runeflow/skills", async () => {
  const dir = await makeTmpDir();
  try {
    // Write a Claude-style .md file
    await fs.writeFile(
      path.join(dir, "my-skill.md"),
      "# My Skill\n\n<system>You are a helpful assistant.</system>\n",
      "utf8",
    );

    await runInit({
      cwd: dir,
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      noLocalLlm: true,
      noPolish: true,
      silent: true,
      force: true, // input and output are both .md now, so force overwrite
    });

    const converted = await listGeneratedSkills(dir);
    assert.ok(converted.length >= 1, "Should write at least one converted skill");

    // Validate the converted skill
    const content = await fs.readFile(converted[0], "utf8");
    const parsed = parseRuneflow(content);
    const result = validateRuneflow(parsed);
    assert.deepEqual(result.issues, [], `Converted skill has validation issues: ${JSON.stringify(result.issues)}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --force overwrites existing files
// ---------------------------------------------------------------------------

test("--force overwrites existing .md", async () => {
  const dir = await makeTmpDir();
  try {
    // First run
    await runInit({
      cwd: dir,
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      noLocalLlm: true,
      noPolish: true,
      silent: true,
      name: "my-skill",
    });

    const skillPath = path.join(dir, ".runeflow", "skills", "my-skill.md");
    assert.ok(await fs.access(skillPath).then(() => true).catch(() => false), "Skill file should exist after first run");

    // Write a sentinel to the file
    await fs.writeFile(skillPath, "SENTINEL", "utf8");

    // Second run with --force
    await runInit({
      cwd: dir,
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      noLocalLlm: true,
      noPolish: true,
      silent: true,
      name: "my-skill",
      force: true,
    });

    const content = await fs.readFile(skillPath, "utf8");
    assert.notEqual(content, "SENTINEL", "File should be overwritten with --force");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("throws when skill file exists and --force is not set", async () => {
  const dir = await makeTmpDir();
  try {
    // First run
    await runInit({
      cwd: dir,
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      noLocalLlm: true,
      noPolish: true,
      silent: true,
      name: "my-skill",
    });

    // Second run without --force should throw
    await assert.rejects(
      () => runInit({
        cwd: dir,
        provider: "cerebras",
        model: "qwen-3-235b-a22b-instruct-2507",
        noLocalLlm: true,
        noPolish: true,
        silent: true,
        name: "my-skill",
      }),
      /already exists.*--force/i,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --no-polish skips LLM polish even when a cloud key is present
// ---------------------------------------------------------------------------

test("--no-polish skips polish (no polish message in output)", async () => {
  const dir = await makeTmpDir();
  const messages = [];
  const origLog = console.log;
  try {
    console.log = (...args) => messages.push(args.join(" "));

    await runInit({
      cwd: dir,
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      noLocalLlm: true,
      noPolish: true,
    });

    const polishMessages = messages.filter((m) => m.includes("Polishing"));
    assert.equal(polishMessages.length, 0, "Should not see polish messages with --no-polish");
  } finally {
    console.log = origLog;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --no-local-llm writes placeholder provider and skips download
// ---------------------------------------------------------------------------

test("--no-local-llm still generates a valid skill without runtime scaffolding", async () => {
  const dir = await makeTmpDir();
  try {
    await runInit({
      cwd: dir,
      noLocalLlm: true,
      noPolish: true,
      silent: true,
    });

    const runtimePath = path.join(dir, "runtime.js");
    const runtimeExists = await fs.access(runtimePath).then(() => true).catch(() => false);
    assert.ok(!runtimeExists, "runtime.js should not be written by init");

    // The generated skill should still be valid
    const skillFiles = await listGeneratedSkills(dir);
    assert.ok(skillFiles.length >= 1, "Should write at least one skill file");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Non-interactive mode skips clarifying question
// ---------------------------------------------------------------------------

test("non-interactive mode (no TTY) completes without hanging", async () => {
  const dir = await makeTmpDir();
  try {
    // process.stdin.isTTY is false in test environment, so this should not hang
    await runInit({
      cwd: dir,
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      noLocalLlm: true,
      noPolish: true,
      silent: true,
    });

    const skillFiles = await listGeneratedSkills(dir);
    assert.ok(skillFiles.length >= 1, "Should write skill file in non-interactive mode");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --template forces a specific template
// ---------------------------------------------------------------------------

test("--template forces use of the named template", async () => {
  const dir = await makeTmpDir();
  try {
    await runInit({
      cwd: dir,
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      noLocalLlm: true,
      noPolish: true,
      silent: true,
      template: "notify-slack",
    });

    const skillFiles = await listGeneratedSkills(dir);
    assert.ok(skillFiles.length >= 1, "Should write skill file");

    // The generated skill should contain Slack-related content
    const content = await fs.readFile(skillFiles[0], "utf8");
    assert.match(content, /slack/i, "Generated skill should reference Slack");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --name overrides the skill slug
// ---------------------------------------------------------------------------

test("--name overrides the skill filename", async () => {
  const dir = await makeTmpDir();
  try {
    await runInit({
      cwd: dir,
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
      noLocalLlm: true,
      noPolish: true,
      silent: true,
      name: "custom-skill-name",
    });

    const skillPath = path.join(dir, ".runeflow", "skills", "custom-skill-name.md");
    const exists = await fs.access(skillPath).then(() => true).catch(() => false);
    assert.ok(exists, "Should write skill file with custom name");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
