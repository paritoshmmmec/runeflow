// Feature: smarter-init, Property 1: Signal set always contains required fields

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import * as fc from "fast-check";
import { inspectRepo } from "../src/init-inspector.js";

// Required top-level fields per the SignalSet spec
const REQUIRED_FIELDS = [
  "repoName",
  "primaryLanguage",
  "packageManager",
  "ciProvider",
  "scripts",
  "integrations",
  "existingSkillNames",
  "existingSkillTools",
  "gitCommits",
  "extraContext",
  "claudeSkillFiles",
];

/**
 * Create a temp directory, optionally populate it with synthetic repo files
 * based on the random flags, run inspectRepo, then clean up.
 *
 * Validates: Requirements 1.5, 1.4
 */
test("Property 1: Signal set always contains required fields for any combination of repo files", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        hasPackageJson: fc.boolean(),
        hasGitLog: fc.boolean(),   // used as a hint; git state is not directly controllable
        hasCiFile: fc.boolean(),
        hasRuneflowMd: fc.boolean(),
      }),
      async ({ hasPackageJson, hasCiFile, hasRuneflowMd }) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rf-prop1-"));
        try {
          // Optionally write a minimal package.json
          if (hasPackageJson) {
            await fs.writeFile(
              path.join(tempDir, "package.json"),
              JSON.stringify({ name: "test-repo", scripts: { test: "node --test" }, dependencies: {} }),
              "utf8",
            );
          }

          // Optionally write a minimal CI workflow file
          if (hasCiFile) {
            const workflowsDir = path.join(tempDir, ".github", "workflows");
            await fs.mkdir(workflowsDir, { recursive: true });
            await fs.writeFile(
              path.join(workflowsDir, "ci.yml"),
              "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v3\n",
              "utf8",
            );
          }

          // Optionally write a minimal .md skill file
          if (hasRuneflowMd) {
            await fs.writeFile(
              path.join(tempDir, "test.md"),
              "---\nname: test-skill\ndescription: A test skill\nversion: 0.1\ninputs: {}\noutputs:\n  result: string\n---\n\n# Test Skill\n",
              "utf8",
            );
          }

          const signals = await inspectRepo({ cwd: tempDir });

          // Assert every required field is present and non-null
          for (const field of REQUIRED_FIELDS) {
            assert.ok(
              Object.prototype.hasOwnProperty.call(signals, field),
              `Missing required field: ${field}`,
            );
            assert.notEqual(
              signals[field],
              null,
              `Field "${field}" must not be null`,
            );
            assert.notEqual(
              signals[field],
              undefined,
              `Field "${field}" must not be undefined`,
            );
          }
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true });
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 2: Known SDK detection
// ---------------------------------------------------------------------------

const KNOWN_SDKS = [
  { pkg: "stripe", signal: "stripe" },
  { pkg: "twilio", signal: "twilio" },
  { pkg: "@sendgrid/mail", signal: "sendgrid" },
  { pkg: "@slack/web-api", signal: "slack" },
  { pkg: "@linear/sdk", signal: "linear" },
  { pkg: "@octokit/rest", signal: "github" },
  { pkg: "@notionhq/client", signal: "notion" },
  { pkg: "@supabase/supabase-js", signal: "supabase" },
  { pkg: "prisma", signal: "prisma" },
  { pkg: "mongoose", signal: "mongoose" },
  { pkg: "@aws-sdk/client-s3", signal: "aws" },
  { pkg: "composio-core", signal: "composio" },
];

/**
 * Validates: Requirements 2.1
 */
test("Property 2: Known SDK detection — integrations contains the expected signal for each injected SDK", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.subarray(KNOWN_SDKS, { minLength: 1 }),
      async (subset) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rf-prop2-"));
        try {
          const dependencies = Object.fromEntries(
            subset.map(({ pkg }) => [pkg, "*"]),
          );
          await fs.writeFile(
            path.join(tempDir, "package.json"),
            JSON.stringify({ name: "test-repo", dependencies }),
            "utf8",
          );

          const signals = await inspectRepo({ cwd: tempDir });

          for (const { signal } of subset) {
            assert.ok(
              signals.integrations.includes(signal),
              `Expected integrations to include "${signal}" but got: ${JSON.stringify(signals.integrations)}`,
            );
          }
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true });
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 3: Claude skill file detection completeness
// ---------------------------------------------------------------------------

const MARKER_SNIPPETS = [
  "<system>\nYou are a helpful assistant.\n</system>",
  "<instructions>\nDo the task.\n</instructions>",
  "## Tools\n\n- search: Search the web",
  "## Tool Use\n\nUse tools carefully.",
  "Input: { query: string }\nOutput: { result: string }",
  "<tool_use>\n{ \"tool\": \"search\" }\n</tool_use>",
];

/**
 * Validates: Requirements 3.1
 */
test("Property 3: Claude skill file detection completeness — any .md file with at least one marker is detected", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.subarray(MARKER_SNIPPETS, { minLength: 0 }),
      async (subset) => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rf-prop3-"));
        try {
          const fileName = "skill-candidate.md";
          const content = subset.length > 0
            ? `# Skill\n\n${subset.join("\n\n")}\n`
            : "# Plain Markdown\n\nNo markers here.\n";

          await fs.writeFile(path.join(tempDir, fileName), content, "utf8");

          const signals = await inspectRepo({ cwd: tempDir });

          if (subset.length > 0) {
            assert.ok(
              signals.claudeSkillFiles.some((f) => f.relativePath === fileName),
              `Expected claudeSkillFiles to include "${fileName}" when markers are present, but got: ${JSON.stringify(signals.claudeSkillFiles.map((f) => f.relativePath))}`,
            );
          } else {
            assert.ok(
              !signals.claudeSkillFiles.some((f) => f.relativePath === fileName),
              `Expected claudeSkillFiles NOT to include "${fileName}" when no markers are present`,
            );
          }
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true });
        }
      },
    ),
    { numRuns: 100 },
  );
});
