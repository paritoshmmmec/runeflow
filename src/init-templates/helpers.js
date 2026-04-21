import { slugify } from "../init-utils.js";

export function defaultSkillName(templateId, options = {}) {
  return slugify(options.name ?? templateId);
}

function formatShapeValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatShapeValue(item)).join(", ")}]`;
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatShapeBlock(key, shape) {
  const entries = Object.entries(shape ?? {});
  if (entries.length === 0) {
    return `${key}: {}`;
  }

  return [
    `${key}:`,
    ...entries.map(([field, value]) => `  ${field}: ${formatShapeValue(value)}`),
  ].join("\n");
}

export function buildFrontmatter({ name, description, inputs = {}, outputs = {}, llmConfig = null }) {
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "version: 0.1",
    formatShapeBlock("inputs", inputs),
    formatShapeBlock("outputs", outputs),
  ];

  if (llmConfig && (llmConfig.provider || llmConfig.model)) {
    lines.push("llm:");
    if (llmConfig.provider) {
      lines.push(`  provider: ${llmConfig.provider}`);
    }
    if (llmConfig.model) {
      lines.push(`  model: ${llmConfig.model}`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}
