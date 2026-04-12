#!/usr/bin/env node
/**
 * runeflow-mcp — MCP server exposing runeflow_run and runeflow_validate as tools.
 *
 * Add to your Claude Code / Cursor MCP config (.mcp.json or mcp.json):
 *
 *   {
 *     "mcpServers": {
 *       "runeflow": {
 *         "command": "npx",
 *         "args": ["runeflow-mcp"],
 *         "env": { "CEREBRAS_API_KEY": "${CEREBRAS_API_KEY}" }
 *       }
 *     }
 *   }
 *
 * Then in Claude Code or Cursor:
 *   "Use runeflow_run to run ./draft-pr.md with inputs {\"base_branch\": \"main\"}"
 */

import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Lazy-load runeflow so the server starts fast even if runeflow isn't installed globally
async function loadRuneflow() {
  try {
    return await import("runeflow");
  } catch {
    throw new Error(
      "runeflow-mcp requires 'runeflow' to be installed.\n" +
      "  Fix: npm install runeflow",
    );
  }
}

const server = new McpServer({
  name: "runeflow-mcp",
  version: "0.3.0",
});

// ─── runeflow_run ─────────────────────────────────────────────────────────────

server.registerTool(
  "runeflow_run",
  {
    description:
      "Run a .md skill file end-to-end. The Runeflow runtime owns sequencing, " +
      "retries, tool calls, and schema validation. Returns structured JSON outputs and a " +
      "run_id you can inspect with `runeflow inspect-run <run_id>`.",
    inputSchema: {
      skill_path: z.string().describe(
        "Path to the .md skill file, relative to cwd or absolute.",
      ),
      inputs: z.record(z.any()).optional().describe(
        "Input values for the skill. Must match the skill's declared inputs schema.",
      ),
      runs_dir: z.string().optional().describe(
        "Directory for run artifacts. Defaults to .runeflow-runs in the skill's directory.",
      ),
    },
  },
  async ({ skill_path, inputs = {}, runs_dir }) => {
    const { parseRuneflow, runRuneflow, createDefaultRuntime, closeRuntimePlugins } = await loadRuneflow();

    const absolutePath = path.resolve(skill_path);
    const skillDir = path.dirname(absolutePath);

    let source;
    try {
      source = await fs.readFile(absolutePath, "utf8");
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to read skill file '${skill_path}': ${error.message}` }],
        isError: true,
      };
    }

    let definition;
    try {
      definition = parseRuneflow(source, { sourcePath: absolutePath });
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to parse skill '${skill_path}': ${error.message}` }],
        isError: true,
      };
    }

    const runtime = createDefaultRuntime();
    let run;

    try {
      run = await runRuneflow(definition, inputs, runtime, {
        runsDir: runs_dir ?? path.join(skillDir, ".runeflow-runs"),
        cwd: skillDir,
      });
    } catch (error) {
      return {
        content: [{ type: "text", text: `Skill execution threw: ${error.message}` }],
        isError: true,
      };
    } finally {
      await closeRuntimePlugins(runtime).catch(() => {});
    }

    const result = {
      status: run.status,
      run_id: run.run_id,
      outputs: run.outputs,
      ...(run.status !== "success" ? { error: run.error } : {}),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: run.status !== "success",
    };
  },
);

// ─── runeflow_validate ────────────────────────────────────────────────────────

server.registerTool(
  "runeflow_validate",
  {
    description:
      "Validate a .md skill file without running it. Checks references, schemas, " +
      "and step wiring. Returns { valid, issues, warnings }.",
    inputSchema: {
      skill_path: z.string().describe("Path to the .md skill file."),
    },
  },
  async ({ skill_path }) => {
    const { parseRuneflow, validateRuneflow } = await loadRuneflow();

    const absolutePath = path.resolve(skill_path);

    let source;
    try {
      source = await fs.readFile(absolutePath, "utf8");
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to read skill file '${skill_path}': ${error.message}` }],
        isError: true,
      };
    }

    let definition;
    try {
      definition = parseRuneflow(source, { sourcePath: absolutePath });
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to parse skill '${skill_path}': ${error.message}` }],
        isError: true,
      };
    }

    const validation = validateRuneflow(definition);

    return {
      content: [{ type: "text", text: JSON.stringify(validation, null, 2) }],
      isError: !validation.valid,
    };
  },
);

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
