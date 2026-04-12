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

function extractRuneflowBlocks(markdownBody) {
  const matches = [...markdownBody.matchAll(/```(?:runeflow|skill)\n([\s\S]*?)\n```/g)];

  if (matches.length === 0) {
    return {
      docs: markdownBody.trim(),
      sections: [],
    };
  }

  // Build sections: each entry has the prose preceding the block + the block source.
  // Global docs = all prose with the runeflow blocks stripped out.
  const sections = [];
  let cursor = 0;
  let globalDocs = "";

  for (const match of matches) {
    const proseBefore = markdownBody.slice(cursor, match.index).trim();
    globalDocs += (globalDocs && proseBefore ? "\n\n" : "") + proseBefore;
    sections.push({
      sectionDocs: proseBefore,
      workflowSource: match[1].trim(),
    });
    cursor = match.index + match[0].length;
  }

  // Trailing prose after the last block
  const trailingProse = markdownBody.slice(cursor).trim();
  if (trailingProse) {
    globalDocs += (globalDocs ? "\n\n" : "") + trailingProse;
  }

  return {
    docs: globalDocs.trim(),
    sections,
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

  const line = source.slice(0, openBraceIndex).split("\n").length;
  throw new SkillSyntaxError("Unterminated block — missing closing '}'.", {
    line,
    hint: "Every step { ... } block needs a matching closing brace.",
  });
}

function parseHeaderAttributes(attributeSource) {
  const attributes = {};
  const tokens = attributeSource.trim() ? attributeSource.trim().split(/\s+/) : [];

  for (const token of tokens) {
    const [key, value] = token.split("=");
    if (!key || value === undefined) {
      throw new SkillSyntaxError(`Invalid header attribute '${token}'.`, {
        hint: "Attributes must be key=value pairs, e.g. type=tool or retry=3.",
      });
    }
    attributes[key] = value;
  }

  return attributes;
}

function parsePropertyValue(rawValue) {
  if (!rawValue.trim()) {
    return null;
  }

  // If the value looks like an expression containing a ternary (? ... :),
  // YAML will misparse it as a complex mapping key. Detect this and return
  // the raw string so the expression engine can handle it at runtime.
  const trimmed = rawValue.trim();
  if (/\?/.test(trimmed) && /\b(?:inputs|steps|const)\./.test(trimmed)) {
    return trimmed;
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

function parseStep(header, body, lineHint) {
  const match = header.match(/^step\s+([A-Za-z_][A-Za-z0-9_-]*)(?:\s+(.*))?$/);

  if (!match) {
    throw new SkillSyntaxError(`Invalid step declaration '${header}'.`, {
      line: lineHint,
      hint: "Expected: step <id> type=<kind> { ... }  e.g. step fetch type=tool { ... }",
    });
  }

  const [, id, attributesSource = ""] = match;
  const attributes = parseHeaderAttributes(attributesSource);

  if (!attributes.type) {
    throw new SkillSyntaxError(`Step '${id}' is missing a type.`, {
      line: lineHint,
      hint: `Add type=<kind> to the step header. Valid kinds: tool, llm, cli, transform, branch, parallel, block, human_input, fail.`,
    });
  }

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

function parseBranch(header, body, lineHint) {
  const match = header.match(/^branch\s+([A-Za-z_][A-Za-z0-9_-]*)$/);

  if (!match) {
    throw new SkillSyntaxError(`Invalid branch declaration '${header}'.`, {
      line: lineHint,
      hint: "Expected: branch <id> { if: <expr>  then: <step>  else: <step> }",
    });
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
      imports: [],
      steps: [],
      output: {},
    };
  }

  const source = normalizeNewlines(workflowSource);
  const imports = [];
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

    if (source.startsWith("import ", index)) {
      const lineEnd = source.indexOf("\n", index);
      const end = lineEnd === -1 ? source.length : lineEnd;
      const line = source.slice(index, end).trim();
      const match = line.match(/^import\s+blocks\s+from\s+["'](.+)["']$/);
      if (!match) {
        throw new SkillSyntaxError(`Invalid import declaration: '${line}'`);
      }
      imports.push({ kind: "blocks", path: match[1] });
      index = end;
      continue;
    }

    const braceIndex = source.indexOf("{", index);

    if (braceIndex === -1) {
      throw new SkillSyntaxError("Expected block opening '{'.");
    }

    const header = source.slice(index, braceIndex).trim();
    const blockEnd = findMatchingBrace(source, braceIndex);
    const body = source.slice(braceIndex + 1, blockEnd).trimEnd();
    const lineHint = source.slice(0, index).split("\n").length;

    if (header.startsWith("step ")) {
      steps.push(parseStep(header, body, lineHint));
    } else if (header.startsWith("branch ")) {
      steps.push(parseBranch(header, body, lineHint));
    } else if (header.startsWith("parallel ")) {
      steps.push(parseParallel(header, body));
    } else if (header.startsWith("block ")) {
      blocks.push(parseBlockTemplate(header, body));
    } else if (header === "output") {
      output = parseOutputBlock(body);
    } else {
      throw new SkillSyntaxError(`Unsupported block header '${header}'.`, {
        line: lineHint,
        hint: "Valid block types: step, branch, parallel, block, output.",
      });
    }

    index = blockEnd + 1;
  }

  return { imports, steps, output, blocks };
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
  const { docs: rawDocs, sections } = extractRuneflowBlocks(remainder);
  const { docBlocks, cleanedBody } = extractDocBlocks(rawDocs);

  // Merge all runeflow blocks into one workflow, tracking which section
  // each step came from so we can scope docs projection per llm step.
  const stepDocs = {};
  let mergedWorkflowSource = "";

  if (sections.length === 0) {
    mergedWorkflowSource = "";
  } else if (sections.length === 1) {
    mergedWorkflowSource = sections[0].workflowSource;
    // Single block — section docs are the same as global docs, no per-step override needed
  } else {
    // Multiple blocks: parse each independently to get step ids, then merge sources
    for (const section of sections) {
      if (!section.workflowSource.trim()) continue;
      // Quick pass to extract step ids from this section
      try {
        const partial = parseWorkflow(section.workflowSource);
        for (const step of partial.steps ?? []) {
          if (section.sectionDocs) {
            stepDocs[step.id] = section.sectionDocs;
          }
        }
      } catch {
        // If a section fails to parse, we'll catch it in the full merge below
      }
      mergedWorkflowSource += (mergedWorkflowSource ? "\n\n" : "") + section.workflowSource;
    }
  }

  const rawWorkflow = (() => {
    try {
      return parseWorkflow(mergedWorkflowSource);
    } catch (err) {
      if (err instanceof SkillSyntaxError && err.line != null && !err.source) {
        throw new SkillSyntaxError(err.message.split("\n")[0], {
          line: err.line,
          source: mergedWorkflowSource,
          hint: err.hint ?? undefined,
        });
      }
      throw err;
    }
  })();
  const workflow = rawWorkflow.imports?.length > 0
    ? rawWorkflow
    : resolveWorkflowBlocks(rawWorkflow);

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
      runeflow: frontmatter.runeflow ?? null,
    },
    consts: frontmatter.const ?? {},
    docs: cleanedBody,
    docBlocks,
    stepDocs: Object.keys(stepDocs).length > 0 ? stepDocs : null,
    workflow,
    raw: source,
  };
}

export const parseRuneflow = parseSkill;
