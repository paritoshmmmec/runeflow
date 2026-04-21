/**
 * init-inspector.js — Repo_Inspector for smarter-init.
 *
 * Reads the repository and environment, returning a normalised SignalSet.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Known integration SDK map: package name → signal name
// ---------------------------------------------------------------------------

const SDK_MAP = {
  "stripe": "stripe",
  "twilio": "twilio",
  "@sendgrid/mail": "sendgrid",
  "@slack/web-api": "slack",
  "@linear/sdk": "linear",
  "@octokit/rest": "github",
  "@notionhq/client": "notion",
  "@supabase/supabase-js": "supabase",
  "prisma": "prisma",
  "mongoose": "mongoose",
  "composio-core": "composio",
};

// Prefix-based match: any @aws-sdk/* → "aws"
const AWS_PREFIX = "@aws-sdk/";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a file as text, returning null on any error. */
async function tryRead(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/** List directory entries, returning [] on any error. */
async function tryReaddir(dirPath) {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

/** Resolve integrations from a set of package names. */
function detectIntegrations(packageNames) {
  const found = new Set();
  for (const name of packageNames) {
    if (name.startsWith(AWS_PREFIX)) {
      found.add("aws");
      continue;
    }
    const signal = SDK_MAP[name];
    if (signal) found.add(signal);
  }
  return [...found];
}

/** Extract all package names from package.json deps + devDeps. */
function extractPackageNames(pkg) {
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
}

/** Detect integrations from top-level node_modules directory entries. */
async function detectNodeModulesIntegrations(cwd) {
  const nmPath = path.join(cwd, "node_modules");
  const entries = await tryReaddir(nmPath);
  // Also check scoped packages one level deep
  const allNames = [];
  for (const entry of entries) {
    if (entry.startsWith("@")) {
      const scopedEntries = await tryReaddir(path.join(nmPath, entry));
      for (const sub of scopedEntries) {
        allNames.push(`${entry}/${sub}`);
      }
    } else {
      allNames.push(entry);
    }
  }
  return detectIntegrations(allNames);
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

async function detectLanguage(cwd, topLevelFiles) {
  const fileSet = new Set(topLevelFiles.map((f) => f.toLowerCase()));

  if (fileSet.has("cargo.toml")) return "rust";
  if (fileSet.has("go.mod")) return "go";
  if (fileSet.has("gemfile")) return "ruby";
  if (fileSet.has("requirements.txt") || fileSet.has("pyproject.toml")) return "python";

  if (fileSet.has("package.json")) {
    // Check for TypeScript indicators
    if (fileSet.has("tsconfig.json")) return "typescript";
    // Check for .ts files in src/
    const srcEntries = await tryReaddir(path.join(cwd, "src"));
    if (srcEntries.some((f) => f.endsWith(".ts"))) return "typescript";
    return "javascript";
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

function detectPackageManager(topLevelFiles) {
  const fileSet = new Set(topLevelFiles.map((f) => f.toLowerCase()));
  if (fileSet.has("yarn.lock")) return "yarn";
  if (fileSet.has("pnpm-lock.yaml")) return "pnpm";
  if (fileSet.has("package-lock.json") || fileSet.has("package.json")) return "npm";
  return "none";
}

// ---------------------------------------------------------------------------
// CI provider detection
// ---------------------------------------------------------------------------

async function detectCiProvider(cwd, topLevelFiles) {
  const fileSet = new Set(topLevelFiles.map((f) => f.toLowerCase()));

  // Check .github/workflows/ directory
  const workflowsPath = path.join(cwd, ".github", "workflows");
  const workflowEntries = await tryReaddir(workflowsPath);
  if (workflowEntries.length > 0) return "github-actions";

  if (fileSet.has(".travis.yml")) return "travis";
  if (fileSet.has("jenkinsfile")) return "jenkins";

  // Check .circleci/config.yml
  const circleciConfig = await tryRead(path.join(cwd, ".circleci", "config.yml"));
  if (circleciConfig !== null) return "circleci";

  return "none";
}

// ---------------------------------------------------------------------------
// Git log
// ---------------------------------------------------------------------------

async function getGitCommits(cwd) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--format=%s", "-20"],
      { cwd, timeout: 5000 },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Existing .md skill parsing
// ---------------------------------------------------------------------------

/** Extract name from YAML frontmatter between --- delimiters. */
function extractFrontmatterName(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const nameMatch = match[1].match(/^name:\s*(.+)$/m);
  return nameMatch ? nameMatch[1].trim() : null;
}

/** Extract tool names from `tool: <name>` lines in runeflow blocks. */
function extractToolNames(content) {
  const tools = [];
  // Match tool: <name> lines (not tool_use or similar)
  const matches = content.matchAll(/^\s*tool:\s*([^\s#]+)/gm);
  for (const m of matches) {
    tools.push(m[1].trim());
  }
  return tools;
}

async function readExistingSkills(cwd) {
  const skillNames = [];
  const skillTools = [];
  const seenNames = new Set();

  async function walk(dir, depth, maxDepth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === ".runeflow") {
          await walk(path.join(fullPath, "skills"), depth + 1, maxDepth);
          continue;
        }
        await walk(fullPath, depth + 1, maxDepth);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      const content = await tryRead(fullPath);
      if (content === null) {
        continue;
      }

      const hasRuneflowBlock = /```(?:runeflow|skill)\n/.test(content);
      if (!hasRuneflowBlock) {
        continue;
      }

      const name = extractFrontmatterName(content) ?? path.basename(entry.name, ".md");
      if (!seenNames.has(name)) {
        seenNames.add(name);
        skillNames.push(name);
      }

      const tools = extractToolNames(content);
      skillTools.push(...tools);
    }
  }

  await walk(cwd, 0, 4);

  return { skillNames, skillTools: [...new Set(skillTools)] };
}

// ---------------------------------------------------------------------------
// Claude skill file detection
// ---------------------------------------------------------------------------

const CLAUDE_MARKERS = [
  { pattern: /<system>|<instructions>/i, marker: "system-block" },
  { pattern: /^##\s+Tools?(?:\s+Use)?/m, marker: "tools-section" },
  { pattern: /^Input:|^Output:/m, marker: "io-annotations" },
  { pattern: /<tool_use>/i, marker: "tool-use-block" },
];

function detectClaudeMarkers(content) {
  const markers = [];
  for (const { pattern, marker } of CLAUDE_MARKERS) {
    if (pattern.test(content)) markers.push(marker);
  }
  return markers;
}

/** Extract title: first # heading or filename stem. */
function extractTitle(content, filePath) {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  return path.basename(filePath, path.extname(filePath));
}

/**
 * Recursively scan for Claude-style .md files up to maxDepth levels.
 * Skips node_modules and .git directories.
 */
async function scanClaudeSkillFiles(dir, cwd, depth, maxDepth) {
  if (depth > maxDepth) return [];

  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    // Skip hidden dirs and node_modules
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await scanClaudeSkillFiles(fullPath, cwd, depth + 1, maxDepth);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const content = await tryRead(fullPath);
      if (content === null) continue;

      // Skip files that are already runeflow workflows
      if (/^runeflow:\s*true\s*$/m.test(content) || /```(?:runeflow|skill)\n/.test(content)) continue;

      const markers = detectClaudeMarkers(content);
      if (markers.length === 0) continue;

      results.push({
        path: fullPath,
        relativePath: path.relative(cwd, fullPath),
        title: extractTitle(content, fullPath),
        markers,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Inspect the repository and return a normalised SignalSet.
 *
 * @param {object} options
 * @param {string} [options.cwd]          - directory to inspect (default: process.cwd())
 * @param {string[]} [options.extraContext] - additional context strings (from --context flag)
 * @returns {Promise<SignalSet>}
 */
export async function inspectRepo(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const extraContext = options.extraContext ?? [];

  // Repo name: default to directory basename, overridden by package.json name
  let repoName = path.basename(cwd);
  let scripts = [];
  let pkgIntegrations = [];

  // Top-level file listing
  const topLevelFiles = await tryReaddir(cwd);

  // Read package.json
  const pkgRaw = await tryRead(path.join(cwd, "package.json"));
  if (pkgRaw !== null) {
    try {
      const pkg = JSON.parse(pkgRaw);
      if (pkg.name) repoName = pkg.name;
      scripts = Object.keys(pkg.scripts ?? {});
      pkgIntegrations = detectIntegrations(extractPackageNames(pkg));
    } catch {
      // malformed package.json — skip
    }
  }

  // node_modules integrations (top-level only)
  const nmIntegrations = await detectNodeModulesIntegrations(cwd);

  // Merge integrations, deduplicate
  const integrations = [...new Set([...pkgIntegrations, ...nmIntegrations])];

  // Language, package manager, CI provider
  const primaryLanguage = await detectLanguage(cwd, topLevelFiles);
  const packageManager = detectPackageManager(topLevelFiles);
  const ciProvider = await detectCiProvider(cwd, topLevelFiles);

  // Git commits
  const gitCommits = await getGitCommits(cwd);

  // Existing .md skills
  const { skillNames: existingSkillNames, skillTools: existingSkillTools } =
    await readExistingSkills(cwd);

  // Claude skill files (recursive, up to 3 levels)
  const claudeSkillFiles = await scanClaudeSkillFiles(cwd, cwd, 0, 3);

  return {
    repoName,
    primaryLanguage,
    packageManager,
    ciProvider,
    scripts,
    integrations,
    existingSkillNames,
    existingSkillTools,
    gitCommits,
    extraContext,
    claudeSkillFiles,
  };
}
