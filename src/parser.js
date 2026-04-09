import YAML from "yaml";
import { resolveWorkflowBlocks } from "./blocks.js";
import { SkillSyntaxError } from "./errors.js";
import { countIndent, normalizeNewlines } from "./utils.js";

function extractFrontmatter(source) {
  const normalized = normalizeNewlines(source);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);

  if (!match) {
    return {
      frontmatter: {},
      remainder: normalized,
    };
  }

  let frontmatter;

  try {
    frontmatter = YAML.parse(match[1]) ?? {};
  } catch (error) {
    throw new SkillSyntaxError(`Invalid frontmatter: ${error.message}`);
  }

  return {
    frontmatter,
    remainder: normalized.slice(match[0].length),
  };
}

function extractRuneflowBlock(markdownBody) {
  const matches = [...markdownBody.matchAll(/```(?:runeflow|skill)\n([\s\S]*?)\n```/g)];

  if (matches.length > 1) {
    throw new SkillSyntaxError("Only one ```runeflow fenced block is supported. Legacy ```skill blocks are also accepted.");
  }

  if (matches.length === 0) {
    return {
      docs: markdownBody.trim(),
      workflowSource: "",
    };
  }

  const [match] = matches;
  const docs = (markdownBody.slice(0, match.index) + markdownBody.slice(match.index + match[0].length)).trim();

  return {
    docs,
    workflowSource: match[1].trim(),
  };
}

function findMatchingBrace(source, openBraceIndex) {
  let depth = 0;
  let quote = null;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }

      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  throw new SkillSyntaxError("Unterminated block in skill DSL.");
}

function parseHeaderAttributes(attributeSource) {
  const attributes = {};
  const tokens = attributeSource.trim() ? attributeSource.trim().split(/\s+/) : [];

  for (const token of tokens) {
    const [key, value] = token.split("=");
    if (!key || value === undefined) {
      throw new SkillSyntaxError(`Invalid header attribute '${token}'.`);
    }
    attributes[key] = value;
  }

  return attributes;
}

function parsePropertyValue(rawValue) {
  if (!rawValue.trim()) {
    return null;
  }

  try {
    return YAML.parse(rawValue);
  } catch (error) {
    throw new SkillSyntaxError(`Invalid property value '${rawValue.trim()}': ${error.message}`);
  }
}

function parseBlockProperties(blockBody) {
  const normalized = normalizeNewlines(blockBody);
  const lines = normalized.split("\n");
  const nonEmpty = lines.filter((line) => line.trim());

  if (nonEmpty.length === 0) {
    return {};
  }

  const rootIndent = Math.min(...nonEmpty.map((line) => countIndent(line)));
  const properties = {};
  let currentKey = null;
  let currentValueLines = [];

  function flush() {
    if (!currentKey) {
      return;
    }

    properties[currentKey] = parsePropertyValue(currentValueLines.join("\n"));
    currentKey = null;
    currentValueLines = [];
  }

  for (const line of lines) {
    if (!line.trim()) {
      if (currentKey) {
        currentValueLines.push("");
      }
      continue;
    }

    const indent = countIndent(line);
    const trimmed = line.slice(rootIndent);
    const propertyMatch = indent === rootIndent ? trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/) : null;

    if (propertyMatch) {
      flush();
      currentKey = propertyMatch[1];
      currentValueLines.push(propertyMatch[2]);
      continue;
    }

    if (!currentKey) {
      throw new SkillSyntaxError(`Unexpected content inside block: '${line.trim()}'.`);
    }

    currentValueLines.push(trimmed);
  }

  flush();
  return properties;
}

function parseStep(header, body) {
  const match = header.match(/^step\s+([A-Za-z_][A-Za-z0-9_-]*)(?:\s+(.*))?$/);

  if (!match) {
    throw new SkillSyntaxError(`Invalid step declaration '${header}'.`);
  }

  const [, id, attributesSource = ""] = match;
  const attributes = parseHeaderAttributes(attributesSource);
  const properties = parseBlockProperties(body);

  const step = {
    id,
    kind: attributes.type ?? null,
    retry: attributes.retry ? Number(attributes.retry) : 0,
    fallback: attributes.fallback ?? null,
    next: properties.next ?? attributes.next ?? null,
    failMessage: properties.fail_message ?? null,
    ...properties,
  };
  if (attributes.cache === "false") step.cache = false;
  return step;
}

function parseBlockTemplate(header, body) {
  const match = header.match(/^block\s+([A-Za-z_][A-Za-z0-9_-]*)(?:\s+(.*))?$/);

  if (!match) {
    throw new SkillSyntaxError(`Invalid block declaration '${header}'.`);
  }

  const [, id, attributesSource = ""] = match;
  const attributes = parseHeaderAttributes(attributesSource);
  const properties = parseBlockProperties(body);

  const block = {
    id,
    kind: attributes.type ?? null,
    retry: attributes.retry ? Number(attributes.retry) : 0,
    fallback: attributes.fallback ?? null,
    next: properties.next ?? attributes.next ?? null,
    failMessage: properties.fail_message ?? null,
    ...properties,
  };
  if (attributes.cache === "false") block.cache = false;
  return block;
}

function parseBranch(header, body) {
  const match = header.match(/^branch\s+([A-Za-z_][A-Za-z0-9_-]*)$/);

  if (!match) {
    throw new SkillSyntaxError(`Invalid branch declaration '${header}'.`);
  }

  return {
    id: match[1],
    kind: "branch",
    ...parseBlockProperties(body),
  };
}

function parseParallel(header, body) {
  const match = header.match(/^parallel\s+([A-Za-z_][A-Za-z0-9_-]*)(?:\s+(.*))?$/);

  if (!match) {
    throw new SkillSyntaxError(`Invalid parallel declaration '${header}'.`);
  }

  const [, id, attributesSource = ""] = match;
  const attributes = parseHeaderAttributes(attributesSource);
  const properties = parseBlockProperties(body);

  const parallel = {
    id,
    kind: "parallel",
    retry: attributes.retry ? Number(attributes.retry) : 0,
    fallback: attributes.fallback ?? null,
    next: properties.next ?? attributes.next ?? null,
    failMessage: properties.fail_message ?? null,
    ...properties,
  };
  if (attributes.cache === "false") parallel.cache = false;
  return parallel;
}

function parseOutputBlock(body) {
  return parseBlockProperties(body);
}

function parseWorkflow(workflowSource) {
  if (!workflowSource.trim()) {
    return {
      steps: [],
      output: {},
    };
  }

  const source = normalizeNewlines(workflowSource);
  const steps = [];
  const blocks = [];
  let output = {};
  let index = 0;

  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) {
      index += 1;
    }

    if (index >= source.length) {
      break;
    }

    const braceIndex = source.indexOf("{", index);

    if (braceIndex === -1) {
      throw new SkillSyntaxError("Expected block opening '{'.");
    }

    const header = source.slice(index, braceIndex).trim();
    const blockEnd = findMatchingBrace(source, braceIndex);
    const body = source.slice(braceIndex + 1, blockEnd).trimEnd();

    if (header.startsWith("step ")) {
      steps.push(parseStep(header, body));
    } else if (header.startsWith("branch ")) {
      steps.push(parseBranch(header, body));
    } else if (header.startsWith("parallel ")) {
      steps.push(parseParallel(header, body));
    } else if (header.startsWith("block ")) {
      blocks.push(parseBlockTemplate(header, body));
    } else if (header === "output") {
      output = parseOutputBlock(body);
    } else {
      throw new SkillSyntaxError(`Unsupported block header '${header}'.`);
    }

    index = blockEnd + 1;
  }

  return { steps, output, blocks };
}

function extractDocBlocks(markdownBody) {
  const docBlocks = {};
  const cleaned = markdownBody.replace(/^:::guidance\[([^\]]+)\]\n([\s\S]*?)^:::\n?/gm, (_, name, content) => {
    docBlocks[name.trim()] = content.trim();
    return "";
  });
  return { docBlocks, cleanedBody: cleaned };
}

export function parseSkill(source, options = {}) {
  const { frontmatter, remainder } = extractFrontmatter(source);
  const { docs: rawDocs, workflowSource } = extractRuneflowBlock(remainder);
  const { docBlocks, cleanedBody } = extractDocBlocks(rawDocs);
  const workflow = resolveWorkflowBlocks(parseWorkflow(workflowSource));

  return {
    sourcePath: options.sourcePath ?? null,
    metadata: {
      name: frontmatter.name ?? null,
      description: frontmatter.description ?? null,
      version: frontmatter.version ?? "0.1",
      inputs: frontmatter.inputs ?? {},
      outputs: frontmatter.outputs ?? {},
      llm: frontmatter.llm ?? null,
      mcp_servers: frontmatter.mcp_servers ?? null,
      composio: frontmatter.composio ?? null,
    },
    consts: frontmatter.const ?? {},
    docs: cleanedBody,
    docBlocks,
    workflow,
    raw: source,
  };
}

export const parseRuneflow = parseSkill;
