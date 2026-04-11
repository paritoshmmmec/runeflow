import path from "node:path";
import { parseRuneflow } from "./parser.js";
import { validateRuneflow } from "./validator.js";

const DEFAULT_PROVIDER = "cerebras";
const DEFAULT_MODEL = "qwen-3-235b-a22b-instruct-2507";

// Built-in tool names available in the Runeflow runtime
const BUILTIN_TOOLS = new Set([
  "file.exists",
  "file.read",
  "file.write",
  "git.current_branch",
  "git.diff_summary",
  "git.push_current_branch",
  "git.log",
  "git.tag_list",
  "util.fail",
  "util.complete",
]);

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Derive skill name and slug from source and options.
 * @param {string} source
 * @param {string} sourcePath
 * @returns {{ skillName: string, slug: string, description: string }}
 */
function extractSkillName(source, sourcePath) {
  const headingMatch = source.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    const skillName = headingMatch[1].trim();
    return { skillName, slug: slugify(skillName), description: skillName };
  }
  // Fall back to filename stem
  const stem = path.basename(sourcePath, path.extname(sourcePath));
  const skillName = stem.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { skillName, slug: slugify(stem), description: skillName };
}

/**
 * Extract content from <system> or <instructions> blocks.
 * @param {string} source
 * @returns {string|null}
 */
function extractSystemBlock(source) {
  const systemMatch = source.match(/<system>([\s\S]*?)<\/system>/i);
  if (systemMatch) return systemMatch[1].trim();
  const instrMatch = source.match(/<instructions>([\s\S]*?)<\/instructions>/i);
  if (instrMatch) return instrMatch[1].trim();
  return null;
}

/**
 * Extract tool names from a ## Tools section.
 * Returns array of { name, description } objects.
 * @param {string} source
 * @returns {Array<{ name: string, description: string }>}
 */
function extractToolsSection(source) {
  // Find ## Tools heading and collect lines until next ## heading or end of string
  const toolsSectionMatch = source.match(/^##\s+Tools?\b[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im)
    ?? source.match(/^##\s+Tools?\b[^\n]*\n([\s\S]*)$/im);
  if (!toolsSectionMatch) return [];

  const sectionBody = toolsSectionMatch[1];
  const tools = [];

  for (const line of sectionBody.split("\n")) {
    // Match "- toolName: description" or "- toolName"
    const entryMatch = line.match(/^\s*-\s+([A-Za-z0-9_./-]+)(?::\s*(.+))?$/);
    if (entryMatch) {
      tools.push({
        name: entryMatch[1].trim(),
        description: (entryMatch[2] ?? "").trim(),
      });
    }
  }

  return tools;
}

/**
 * Extract Input: / Output: annotations.
 * @param {string} source
 * @returns {{ inputs: Record<string,string>, outputs: Record<string,string> }}
 */
function extractIOAnnotations(source) {
  const inputs = {};
  const outputs = {};

  for (const line of source.split("\n")) {
    const inputMatch = line.match(/^Input:\s*(.+)$/);
    if (inputMatch) {
      // Parse "key: type" or just "key"
      const [key, type = "string"] = inputMatch[1].split(":").map((s) => s.trim());
      if (key) inputs[key] = type;
    }

    const outputMatch = line.match(/^Output:\s*(.+)$/);
    if (outputMatch) {
      const [key, type = "string"] = outputMatch[1].split(":").map((s) => s.trim());
      if (key) outputs[key] = type;
    }
  }

  return { inputs, outputs };
}

/**
 * Extract <tool_use> blocks and parse JSON inside them.
 * @param {string} source
 * @returns {Array<{ toolName: string, input: Record<string,unknown> }>}
 */
function extractToolUseBlocks(source) {
  const results = [];
  const regex = /<tool_use>([\s\S]*?)<\/tool_use>/gi;
  let match;

  while ((match = regex.exec(source)) !== null) {
    const content = match[1].trim();
    try {
      const parsed = JSON.parse(content);
      const toolName = parsed.name ?? parsed.tool_name ?? parsed.tool ?? "unknown";
      const input = parsed.input ?? parsed.parameters ?? parsed.args ?? {};
      results.push({ toolName, input });
    } catch {
      // Non-JSON tool_use block — use raw content as tool name hint
      const nameMatch = content.match(/"(?:name|tool_name|tool)"\s*:\s*"([^"]+)"/);
      results.push({
        toolName: nameMatch ? nameMatch[1] : "unknown",
        input: {},
      });
    }
  }

  return results;
}

/**
 * Match a tool name to a built-in, or return null.
 * Tries exact match, then partial match.
 * @param {string} name
 * @returns {string|null}
 */
function matchBuiltinTool(name) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9.]/g, ".");
  if (BUILTIN_TOOLS.has(normalized)) return normalized;

  // Try partial matching: e.g. "read_file" → "file.read"
  for (const builtin of BUILTIN_TOOLS) {
    const parts = builtin.split(".");
    if (
      normalized.includes(parts[0]) && normalized.includes(parts[1])
      || normalized.includes(parts[1]) && parts[1].length > 3
    ) {
      return builtin;
    }
  }

  return null;
}

/**
 * Build a tool step string for the runeflow block.
 * @param {string} stepId
 * @param {string} toolName
 * @param {string} originalName
 * @param {Record<string,unknown>} withBindings
 * @returns {string}
 */
function buildToolStep(stepId, toolName, originalName, withBindings = {}) {
  const withStr = Object.keys(withBindings).length > 0
    ? JSON.stringify(withBindings)
    : "{}";

  if (toolName === "replace.me") {
    return [
      `step ${stepId} type=tool {`,
      `  tool: replace.me  # TODO: wire to actual tool — original: ${originalName}`,
      `  with: ${withStr}`,
      `  out: { result: string }`,
      `}`,
    ].join("\n");
  }

  return [
    `step ${stepId} type=tool {`,
    `  tool: ${toolName}`,
    `  with: ${withStr}`,
    `}`,
  ].join("\n");
}

/**
 * Build an LLM step string.
 * @param {string} stepId
 * @param {string} prompt
 * @param {Record<string,string>} schema
 * @returns {string}
 */
function buildLlmStep(stepId, prompt, schema) {
  const schemaStr = JSON.stringify(schema);
  // Escape prompt for multi-line YAML-style string in DSL
  const escapedPrompt = prompt.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    `step ${stepId} type=llm {`,
    `  prompt: "${escapedPrompt}"`,
    `  schema: ${schemaStr}`,
    `}`,
  ].join("\n");
}

/**
 * Build the fallback skeleton when conversion would fail validation.
 */
function buildFallbackSkeleton(source, skillName, slug, description, sourcePath, provider, model) {
  const escapedContent = source.replace(/-->/g, "--&gt;");
  const frontmatter = [
    "---",
    `name: ${slug}`,
    `description: ${description}`,
    "version: 0.1",
    "inputs: {}",
    "outputs:",
    "  result: string",
    "llm:",
    `  provider: ${provider}`,
    `  model: ${model}`,
    "---",
  ].join("\n");

  const body = [
    `<!-- Converted from ${sourcePath} — manual wiring required -->`,
    `<!-- ${escapedContent} -->`,
    "",
    "```runeflow",
    `step run type=llm {`,
    `  prompt: "Complete the task described above."`,
    `  schema: { result: string }`,
    `}`,
    `output { result: steps.run.result }`,
    "```",
  ].join("\n");

  return `${frontmatter}\n\n${body}\n`;
}

/**
 * Convert a Claude-style Markdown skill file into a .runeflow.md string.
 *
 * @param {string} source        - raw Markdown content of the Claude skill file
 * @param {object} options
 * @param {string} options.sourcePath
 * @param {string} [options.provider]  - resolved provider name (default: "cerebras")
 * @param {string} [options.model]     - resolved model identifier
 * @returns {{ output: string, skillName: string, warnings: string[], valid: boolean }}
 */
export function convertClaudeSkill(source, options = {}) {
  const sourcePath = options.sourcePath ?? "unknown.md";
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const model = options.model ?? DEFAULT_MODEL;

  const warnings = [];

  // 1. Extract skill name
  const { skillName, slug, description } = extractSkillName(source, sourcePath);

  // 2. Extract system/instructions block
  const systemContent = extractSystemBlock(source);

  // 3. Extract ## Tools section
  const toolEntries = extractToolsSection(source);

  // 4. Extract Input: / Output: annotations
  const { inputs, outputs: annotatedOutputs } = extractIOAnnotations(source);

  // 5. Extract <tool_use> blocks
  const toolUseBlocks = extractToolUseBlocks(source);

  // Build steps and track step IDs for output block
  const steps = [];
  const stepIds = [];

  // Add tool steps from ## Tools section
  for (const entry of toolEntries) {
    const matched = matchBuiltinTool(entry.name);
    const stepId = slugify(entry.name) || `tool_${stepIds.length + 1}`;
    const uniqueStepId = stepIds.includes(stepId) ? `${stepId}_${stepIds.length}` : stepId;

    if (matched) {
      steps.push(buildToolStep(uniqueStepId, matched, entry.name, {}));
    } else {
      steps.push(buildToolStep(uniqueStepId, "replace.me", entry.name, {}));
      warnings.push(`Tool '${entry.name}' could not be matched to a built-in — placeholder step written`);
    }
    stepIds.push(uniqueStepId);
  }

  // Add tool steps from <tool_use> blocks
  for (const block of toolUseBlocks) {
    const matched = matchBuiltinTool(block.toolName);
    const baseId = slugify(block.toolName) || `tool_use_${stepIds.length + 1}`;
    const stepId = stepIds.includes(baseId) ? `${baseId}_${stepIds.length}` : baseId;

    if (matched) {
      steps.push(buildToolStep(stepId, matched, block.toolName, block.input));
    } else {
      steps.push(buildToolStep(stepId, "replace.me", block.toolName, block.input));
      warnings.push(`tool_use block '${block.toolName}' could not be matched to a built-in — placeholder step written`);
    }
    stepIds.push(stepId);
  }

  // Add LLM step if there's a system/instructions block
  let llmStepId = null;
  if (systemContent) {
    llmStepId = "run";
    // Determine output schema from annotated outputs or default
    const outputSchema = Object.keys(annotatedOutputs).length > 0
      ? annotatedOutputs
      : { result: "string" };
    steps.push(buildLlmStep(llmStepId, systemContent, outputSchema));
    stepIds.push(llmStepId);
  }

  // If no steps at all, add a minimal LLM step
  if (steps.length === 0) {
    llmStepId = "run";
    steps.push(buildLlmStep(llmStepId, "Complete the task described above.", { result: "string" }));
    stepIds.push(llmStepId);
    warnings.push("No mappable content found — minimal LLM step added");
  }

  // Build output block: reference last LLM step or last tool step
  let outputBlock;
  if (llmStepId) {
    const outputSchema = Object.keys(annotatedOutputs).length > 0 ? annotatedOutputs : { result: "string" };
    const outputBindings = Object.keys(outputSchema)
      .map((k) => `  ${k}: steps.${llmStepId}.${k}`)
      .join("\n");
    outputBlock = `output {\n${outputBindings}\n}`;
  } else {
    // Tool-only skill: pick a safe output field from the last step.
    // Placeholder steps declare out: { result: string }, known built-ins have their own schema.
    // We use a generic reference that the validator can resolve via the registered outputSchema.
    const lastId = stepIds[stepIds.length - 1];
    const lastEntry = toolEntries[toolEntries.length - 1] ?? toolUseBlocks[toolUseBlocks.length - 1];
    const lastToolName = lastEntry
      ? matchBuiltinTool(lastEntry.name ?? lastEntry.toolName ?? "")
      : null;

    // Determine a valid output key for the last step
    let outputKey = "result"; // placeholder steps always have this
    if (lastToolName) {
      // Use first key of the registered output schema, or fall back to a safe default
      const knownFirstKeys = {
        "file.read": "content",
        "file.write": "written",
        "file.exists": "exists",
        "git.current_branch": "branch",
        "git.diff_summary": "summary",
        "git.push_current_branch": "pushed",
        "git.log": "commits",
        "git.tag_list": "tags",
        "util.fail": "message",
        "util.complete": "message",
      };
      outputKey = knownFirstKeys[lastToolName] ?? "result";
    }

    outputBlock = `output {\n  result: steps.${lastId}.${outputKey}\n}`;
  }

  // Build outputs frontmatter
  const outputsFrontmatter = Object.keys(annotatedOutputs).length > 0
    ? annotatedOutputs
    : { result: "string" };

  // Build frontmatter
  const hasInputs = Object.keys(inputs).length > 0;
  const inputsYaml = hasInputs
    ? Object.entries(inputs).map(([k, v]) => `  ${k}: ${v}`).join("\n")
    : null;

  const outputsYaml = Object.entries(outputsFrontmatter)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");

  // Determine if we need llm frontmatter (only when there's an llm step)
  const needsLlm = llmStepId !== null;

  const frontmatterLines = [
    "---",
    `name: ${slug}`,
    `description: ${description}`,
    "version: 0.1",
    hasInputs ? `inputs:\n${inputsYaml}` : "inputs: {}",
    `outputs:\n${outputsYaml}`,
  ];

  if (needsLlm) {
    frontmatterLines.push(`llm:\n  provider: ${provider}\n  model: ${model}`);
  }

  frontmatterLines.push("---");

  const frontmatter = frontmatterLines.join("\n");

  // Build guidance section from system content
  const guidanceSection = systemContent
    ? `\n${systemContent}\n`
    : "";

  // Build runeflow block
  const runeflowBlock = [
    "```runeflow",
    ...steps,
    outputBlock,
    "```",
  ].join("\n");

  const output = `${frontmatter}\n${guidanceSection}\n${runeflowBlock}\n`;

  // 6. Validate the output
  let valid = false;
  try {
    const parsed = parseRuneflow(output);
    const result = validateRuneflow(parsed);
    valid = result.valid;
  } catch {
    valid = false;
  }

  // 7. Fall back to skeleton if validation fails
  if (!valid) {
    warnings.push("Conversion produced invalid skill — falling back to minimal valid skeleton");
    const fallback = buildFallbackSkeleton(source, skillName, slug, description, sourcePath, provider, model);
    return {
      output: fallback,
      skillName,
      warnings,
      valid: true,
    };
  }

  return { output, skillName, warnings, valid };
}
