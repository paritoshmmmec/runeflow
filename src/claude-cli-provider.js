/**
 * Claude CLI provider — fallback path used when no other LLM provider has
 * credentials configured AND the `claude` CLI is on PATH.
 *
 * Why this exists: many developers already have the Claude Code CLI logged
 * in. When they run a runeflow skill, we want it to Just Work without
 * asking them to also set ANTHROPIC_API_KEY.
 *
 * How it works: shell out to `claude -p "$prompt" --output-format json`,
 * append a system prompt instructing it to emit a single JSON object
 * matching the step's schema, parse `.result`, and validate.
 *
 * Tradeoffs vs. the SDK path:
 *   - No streaming (partial-object callbacks are ignored).
 *   - Slower cold-start (CLI process spawn).
 *   - No usage metrics propagated back to the run artifact.
 *
 * The SDK path is always preferred when ANTHROPIC_API_KEY is present.
 */

import { spawn } from "node:child_process";

/**
 * Convert a zod schema to a plain-language JSON structure hint.
 * We keep it lightweight — the CLI model infers from the hint plus the
 * `respond with JSON only` instruction.
 */
function zodSchemaHint(zodSchema) {
  try {
    // zod's `_def.typeName` is stable enough for a lightweight description.
    return zodSchema?._def?.typeName ?? "object";
  } catch {
    return "object";
  }
}

function wrapPrompt(userPrompt, zodSchema) {
  const kind = zodSchemaHint(zodSchema);
  const guidance = [
    "Respond with a single valid JSON object and nothing else.",
    "Do not wrap it in markdown fences.",
    "Do not include commentary before or after the JSON.",
    `Expected top-level type: ${kind}.`,
  ].join(" ");
  return `${userPrompt}\n\n${guidance}`;
}

function extractJson(text) {
  if (!text || typeof text !== "string") return null;

  // If the model wrapped the JSON in a ```json ... ``` fence, strip it.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenceMatch ? fenceMatch[1] : text).trim();

  try {
    return JSON.parse(body);
  } catch {
    // Fallback: find the first { ... } or [ ... ] block.
    const braceStart = body.indexOf("{");
    const bracketStart = body.indexOf("[");
    const start = braceStart === -1 ? bracketStart
      : bracketStart === -1 ? braceStart
      : Math.min(braceStart, bracketStart);
    if (start === -1) return null;
    const open = body[start];
    const close = open === "{" ? "}" : "]";
    const end = body.lastIndexOf(close);
    if (end === -1 || end <= start) return null;
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

async function spawnClaude({ args, promptInput }) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    if (promptInput !== undefined) {
      child.stdin.write(promptInput);
    }
    child.stdin.end();
  });
}

/**
 * @param {object} params
 * @param {string} params.prompt      - Resolved step prompt (already includes docs + input).
 * @param {object} params.schema      - zod schema to validate the response.
 * @param {string} [params.model]     - optional claude model name for `--model`.
 * @param {string} params.stepId      - used in error messages.
 * @returns {Promise<object>} parsed + validated object
 */
export async function callClaudeCli({ prompt, schema, model, stepId }) {
  const wrapped = wrapPrompt(prompt, schema);
  const args = ["-p", "--output-format", "json"];
  if (model) args.push("--model", model);

  // Pipe the prompt via stdin to avoid argv length limits on large prompts.
  args[1] = "--"; // `claude -p --` reads prompt from stdin
  // But `-p` with no arg is also supported; use argv when the prompt is small.
  // Keeping it simple: always pass via argv.
  let result;
  if (wrapped.length > 4000) {
    // Long prompt: use stdin path (`claude -p -` with stdin, per CLI docs).
    const stdinArgs = ["-p", "--output-format", "json"];
    if (model) stdinArgs.push("--model", model);
    result = await spawnClaude({ args: stdinArgs, promptInput: wrapped });
  } else {
    const argvArgs = ["-p", wrapped, "--output-format", "json"];
    if (model) argvArgs.push("--model", model);
    result = await spawnClaude({ args: argvArgs });
  }

  if (result.code !== 0) {
    const snippet = (result.stderr || "").slice(-500).trim();
    throw new Error(
      `Step '${stepId}': claude CLI exited with code ${result.code}.\n` +
      (snippet ? `stderr: ${snippet}` : "(no stderr output)"),
    );
  }

  // `claude -p --output-format json` emits an object with a .result field
  // holding the model's final message as a string.
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `Step '${stepId}': failed to parse claude CLI stdout as JSON.\n` +
      `stdout (first 500 chars): ${result.stdout.slice(0, 500)}`,
    );
  }

  const message = typeof envelope?.result === "string"
    ? envelope.result
    : typeof envelope === "string"
    ? envelope
    : null;

  if (!message) {
    throw new Error(
      `Step '${stepId}': claude CLI response had no 'result' string field.\n` +
      `envelope: ${JSON.stringify(envelope).slice(0, 500)}`,
    );
  }

  const parsed = extractJson(message);
  if (parsed === null) {
    throw new Error(
      `Step '${stepId}': claude CLI response was not valid JSON.\n` +
      `model output (first 500 chars): ${message.slice(0, 500)}`,
    );
  }

  // Validate against the step's zod schema. `parse` throws on mismatch.
  try {
    return schema.parse(parsed);
  } catch (error) {
    throw new Error(
      `Step '${stepId}': claude CLI response did not match schema.\n` +
      `error: ${error.message}\n` +
      `parsed: ${JSON.stringify(parsed).slice(0, 500)}`,
    );
  }
}
