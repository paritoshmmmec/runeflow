#!/usr/bin/env node
/**
 * run-agent.js (Loop A)
 *
 * Drives an authoring agent, then measures the skill it produces with
 * Loop B's checks.
 *
 * Procedure:
 *   1. Create a tmpdir.
 *   2. Copy README.md (repo root) and task.md (scenario) into the tmpdir.
 *   3. Symlink bin/runeflow.js and expose a `runeflow` command inside tmpdir.
 *   4. Use the first available authoring backend:
 *      - OpenAI Responses API via OPENAI_API_KEY
 *      - Vercel AI Gateway via AI_GATEWAY_API_KEY
 *      - Claude Code CLI when logged in
 *   5. If the agent produced a .md skill in the tmpdir, run Loop B against it.
 *   6. Emit a JSON result with cycle count (turns observed), concepts, and
 *      pass/fail of the Loop B checks.
 *
 * Skips cleanly when no supported backend is available.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createGateway, generateObject } from "ai";
import { resolveApiKey } from "../../src/auth.js";
import { evaluateSkillAgainstScenario } from "./run-scripted.js";

const __filename = fileURLToPath(import.meta.url);
const HARNESS_DIR = path.dirname(__filename);
const REPO_ROOT = path.resolve(HARNESS_DIR, "../..");
const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = "gpt-4o-mini";
const GATEWAY_MODEL = "openai/gpt-5.4-mini";

const AUTHOR_SKILL_SCHEMA = z.object({
  file_name: z.string(),
  content: z.string(),
});

function hasClaudeCli() {
  try {
    execFileSync("which", ["claude"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function makeTmpdir(scenarioName) {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const dir = path.join(
    os.tmpdir(),
    `runeflow-scenario-${scenarioName}-${stamp}-${process.pid}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function prepareTmpdir(tmpdir, scenarioDir) {
  // README — the only docs the agent gets
  fs.copyFileSync(
    path.join(REPO_ROOT, "README.md"),
    path.join(tmpdir, "README.md"),
  );
  // task.md — the natural-language prompt, copied for the agent to re-read
  fs.copyFileSync(
    path.join(scenarioDir, "task.md"),
    path.join(tmpdir, "task.md"),
  );
  // runeflow CLI — symlinked so `node ./runeflow.js` resolves inside tmpdir
  fs.symlinkSync(
    path.join(REPO_ROOT, "bin", "runeflow.js"),
    path.join(tmpdir, "runeflow.js"),
  );
  fs.symlinkSync(
    path.join(REPO_ROOT, "bin", "runeflow.js"),
    path.join(tmpdir, "runeflow"),
  );
}

function countCyclesFromClaudeResult(claudeJson) {
  // claude -p --output-format json emits a single object with a `num_turns`
  // or similar field depending on version. Fall back to counting tool_use
  // blocks if present, else 1.
  if (typeof claudeJson?.num_turns === "number") return claudeJson.num_turns;
  if (typeof claudeJson?.total_turns === "number") return claudeJson.total_turns;
  if (Array.isArray(claudeJson?.messages)) {
    return claudeJson.messages.filter((m) => m.role === "assistant").length;
  }
  return null;
}

function extractResponseOutputText(json) {
  if (typeof json?.output_text === "string" && json.output_text.trim()) {
    return json.output_text;
  }

  for (const item of json?.output ?? []) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
  }

  return null;
}

function unwrapMarkdownFence(content) {
  if (typeof content !== "string") return content;
  const trimmed = content.trim();
  const match = trimmed.match(/^`{3,}md\s*\n([\s\S]*?)\n`{3,}\s*$/i);
  return match ? match[1] : content;
}

function buildAgentPrompt({ readme, task, previousDraft, feedback }) {
  const sections = [
    "You are authoring a Runeflow skill from a natural-language task.",
    "Use the README as the contract and prefer the minimum-surface solution.",
    "Return only the JSON fields requested by the schema.",
    "",
    "Requirements:",
    "- Prefer `cli` over `tool` when a shell command already exists.",
    "- Prefer the zero-install LLM path. Do not add `llm:` frontmatter unless the task requires pinning a model.",
    "- Produce exactly one Markdown skill file in the current directory.",
    "- The file must contain a fenced ```runeflow block.",
    "- The task may mention running `runeflow validate`; you should make the file valid, but the harness will run validation for you.",
    "",
    "README:",
    readme,
    "",
    "Task:",
    task,
  ];

  if (previousDraft) {
    sections.push(
      "",
      "Previous draft:",
      `File name: ${previousDraft.file_name}`,
      previousDraft.content,
    );
  }

  if (feedback) {
    sections.push("", "Fix these issues in the next draft:", feedback);
  }

  return sections.join("\n");
}

function summarizeEvaluation(evaluation) {
  const lines = [];
  for (const check of evaluation.checks ?? []) {
    if (!check.ok) {
      lines.push(`- ${check.name}: ${JSON.stringify(check.detail)}`);
    }
  }
  if (evaluation.concepts?.over_budget?.length) {
    lines.push(`- concept_budget: over budget concepts = ${evaluation.concepts.over_budget.join(", ")}`);
  }
  return lines.join("\n");
}

function writeDraft(tmpdir, draft) {
  const fileName = path.basename(draft.file_name || "draft-pr-notes.md");
  const filePath = path.join(tmpdir, fileName);
  fs.writeFileSync(filePath, draft.content, "utf8");
  return filePath;
}

async function authorWithGateway(prompt) {
  const apiKey = resolveApiKey("gateway", "scenario-agent", { cwd: REPO_ROOT });
  const gateway = createGateway({ apiKey });
  const { object } = await generateObject({
    model: gateway(GATEWAY_MODEL),
    schema: AUTHOR_SKILL_SCHEMA,
    prompt,
  });
  return object;
}

async function authorWithOpenAI(prompt) {
  const apiKey = resolveApiKey("openai", "scenario-agent", { cwd: REPO_ROOT });
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "runeflow_scenario_skill",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              file_name: { type: "string" },
              content: { type: "string" },
            },
            required: ["file_name", "content"],
          },
        },
      },
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI Responses API error: ${response.status} ${JSON.stringify(json)}`);
  }
  if (json.error) {
    throw new Error(`OpenAI Responses API returned an error: ${JSON.stringify(json.error)}`);
  }
  const outputText = extractResponseOutputText(json);
  if (typeof outputText !== "string" || !outputText.trim()) {
    throw new Error(`OpenAI Responses API returned no output_text: ${JSON.stringify(json)}`);
  }

  const parsed = JSON.parse(outputText);
  return {
    ...parsed,
    content: unwrapMarkdownFence(parsed.content),
  };
}

function tryClaudeAuthor(prompt, tmpdir) {
  return spawnSync(
    "claude",
    [
      "-p", prompt,
      "--output-format", "json",
      "--dangerously-skip-permissions",
      "--max-budget-usd", "1.00",
    ],
    {
      cwd: tmpdir,
      encoding: "utf8",
      timeout: 300_000,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${tmpdir}:${process.env.PATH ?? ""}`,
      },
    },
  );
}

function detectBackend() {
  try {
    resolveApiKey("openai", "scenario-agent", { cwd: REPO_ROOT });
    return { kind: "openai-responses", model: OPENAI_MODEL };
  } catch {}

  try {
    resolveApiKey("gateway", "scenario-agent", { cwd: REPO_ROOT });
    return { kind: "gateway", model: GATEWAY_MODEL };
  } catch {}

  if (hasClaudeCli()) {
    return { kind: "claude-cli" };
  }

  return null;
}

function findProducedSkill(tmpdir) {
  // Look for any .md the agent wrote (not README.md, not task.md)
  const entries = fs.readdirSync(tmpdir, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .filter((n) => n !== "README.md" && n !== "task.md");
  if (candidates.length === 0) return null;
  // Prefer one containing a runeflow fenced block
  for (const name of candidates) {
    const body = fs.readFileSync(path.join(tmpdir, name), "utf8");
    if (body.includes("```runeflow")) return path.join(tmpdir, name);
  }
  return path.join(tmpdir, candidates[0]);
}

async function runAgentScenario(scenarioName) {
  const backend = detectBackend();
  if (!backend) {
    return {
      scenario: scenarioName,
      skipped: true,
      reason: "no authoring backend available (need OPENAI_API_KEY, AI_GATEWAY_API_KEY, or a logged-in claude CLI)",
    };
  }

  const scenarioDir = path.join(REPO_ROOT, "scenarios", scenarioName);
  if (!fs.existsSync(scenarioDir)) {
    throw new Error(`Scenario not found: ${scenarioDir}`);
  }

  const tmpdir = makeTmpdir(scenarioName);
  prepareTmpdir(tmpdir, scenarioDir);

  const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
  const prompt = fs.readFileSync(path.join(scenarioDir, "task.md"), "utf8");
  const budget = JSON.parse(fs.readFileSync(path.join(scenarioDir, "budget.json"), "utf8"));

  const agentResult = {
    backend: backend.kind,
    model: backend.model ?? null,
  };

  let cycles = 0;
  let previousDraft = null;
  let feedback = null;
  let produced = null;
  let evaluation = null;

  for (let attempt = 1; attempt <= (budget.max_cycles ?? 2); attempt += 1) {
    cycles = attempt;
    const cyclePrompt = buildAgentPrompt({
      readme,
      task: prompt,
      previousDraft,
      feedback,
    });

    if (backend.kind === "openai-responses") {
      previousDraft = await authorWithOpenAI(cyclePrompt);
    } else if (backend.kind === "gateway") {
      previousDraft = await authorWithGateway(cyclePrompt);
    } else {
      const spawn = tryClaudeAuthor(cyclePrompt, tmpdir);
      agentResult.exit_code = spawn.status;
      agentResult.stdout_preview = (spawn.stdout ?? "").slice(0, 2000);
      agentResult.stderr_preview = (spawn.stderr ?? "").slice(-1000);

      let claudeJson = null;
      try { claudeJson = JSON.parse(spawn.stdout); } catch {}

      if (claudeJson?.result?.includes("Not logged in")) {
        return {
          scenario: scenarioName,
          skipped: true,
          reason: "claude CLI is installed but not logged in",
          agent: agentResult,
        };
      }

      produced = findProducedSkill(tmpdir);
      if (!produced) {
        feedback = "No Markdown skill file was produced. Write the requested .md file in the current directory.";
        continue;
      }

      evaluation = evaluateSkillAgainstScenario(scenarioName, produced);
      if (evaluation.ok) break;
      feedback = summarizeEvaluation(evaluation);
      continue;
    }

    produced = writeDraft(tmpdir, previousDraft);
    evaluation = evaluateSkillAgainstScenario(scenarioName, produced);
    if (evaluation.ok) break;
    feedback = summarizeEvaluation(evaluation);
  }

  const out = {
    scenario: scenarioName,
    tmpdir,
    agent: agentResult,
    cycles,
    produced_skill: produced ? path.relative(tmpdir, produced) : null,
  };

  if (!produced) {
    out.ok = false;
    out.reason = "agent did not produce a .md skill file";
    return out;
  }

  evaluation = evaluation ?? evaluateSkillAgainstScenario(scenarioName, produced);
  out.ok = evaluation.ok;
  out.checks = evaluation.checks;
  out.concepts = evaluation.concepts;

  return out;
}

// ─── Entry ────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] === __filename;
if (isMain) {
  const scenario = process.argv[2];
  if (!scenario) {
    console.error("Usage: run-agent.js <scenario-name>");
    process.exit(2);
  }

  (async () => {
    const result = await runAgentScenario(scenario);
    if (result.skipped) {
      console.log(`[SKIP] ${result.scenario}: ${result.reason}`);
      console.log(JSON.stringify(result));
      process.exit(0);
    }

    const tag = result.ok ? "PASS" : "FAIL";
    console.log(`[${tag}] ${result.scenario} (agent)`);
    console.log(`  tmpdir:         ${result.tmpdir}`);
    console.log(`  backend:        ${result.agent?.backend ?? "unknown"}`);
    if (result.agent?.model) console.log(`  model:          ${result.agent.model}`);
    console.log(`  cycles:         ${result.cycles ?? "unknown"}`);
    console.log(`  produced:       ${result.produced_skill ?? "(none)"}`);
    if (Array.isArray(result.checks)) {
      for (const check of result.checks) {
        console.log(`  ${check.name.padEnd(15)} ${check.ok ? "✓" : "✗"}`);
      }
    }
    if (result.concepts) {
      console.log(`  concepts used:  ${result.concepts.used.join(", ") || "(none)"}`);
      if (result.concepts.over_budget.length > 0) {
        console.log(`  over-budget:    ${result.concepts.over_budget.join(", ")}`);
      }
    }
    console.log("");
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  })().catch((err) => {
    console.error(`[ERROR] ${err.stack ?? err.message ?? err}`);
    process.exit(2);
  });
}

export { runAgentScenario };
