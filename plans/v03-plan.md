# Runeflow v0.3 — Coding Agent Implementation Plan

## Context for the agent

Runeflow is a deterministic runtime for AI skills. Skills are `.runeflow.md` files
combining YAML frontmatter, Markdown docs, and a fenced `runeflow` DSL block.

The plugin system (`src/runtime-plugins.js`) already ships working implementations of:
- `createMcpClientPlugin` — stdio MCP client with managed session + subprocess reuse
- `createMcpToolPlugin` — lower-level MCP tool plugin factory
- `createComposioClientPlugin` / `createComposioToolPlugin` — full Composio integration

**v0.3 adds three things on top of this:**
1. HTTP/SSE MCP transport (so hosted MCP servers like `mcp.composio.dev` work)
2. Frontmatter `mcp_servers` / `composio` blocks (zero-config, no custom `runtime.js` needed)
3. `runeflow-mcp` server package (expose `runeflow_run` as an MCP tool)

Plus two pre-release fixes that must land first.

---

## Pre-release fixes (do these before anything else)

### Fix 1 — Move `@composio/core` to optional peer dependency

**File:** `package.json`

**Problem:** `@composio/core` is in `dependencies`, so every Runeflow install downloads
it even if the user never uses Composio. The lazy `await import("@composio/core")` in
`createComposioSdkClient` already handles the missing-package case gracefully.

**Change:**

```json
// Remove from "dependencies":
"@composio/core": "^0.6.8"

// Add to "peerDependencies":
"@composio/core": ">=0.6.0"

// Add to "peerDependenciesMeta":
"@composio/core": {
  "optional": true
}
```

**Test:** Run `npm pack --dry-run` and confirm `@composio/core` is not in the bundle.

---

### Fix 2 — Delete `.tmp-composio/` and update `.gitignore`

**Problem:** `.tmp-composio/package.json` and `package-lock.json` are checked in — leftover
from prototyping.

**Steps:**
1. `rm -rf .tmp-composio/`
2. Add `.tmp-composio/` to `.gitignore`
3. Commit: `chore: remove tmp composio scratch dir`

---

## Task 1 — HTTP/SSE MCP transport

### Background

`createMcpClientPlugin` in `src/runtime-plugins.js` currently only supports stdio:

```js
const nextTransport = new StdioClientTransport({ command, args, env, cwd, stderr });
```

Composio's hosted MCP server is HTTP (`https://mcp.composio.dev/...`). The MCP SDK
v1.29.0 (already in `package-lock.json`) ships `StreamableHttpClientTransport` for this.

### 1a — Add `createMcpHttpClientPlugin` to `src/runtime-plugins.js`

Add a new exported function alongside `createMcpClientPlugin`. It takes a `url` instead
of `command`/`args`, and uses `StreamableHttpClientTransport` from the MCP SDK.

**New function signature:**

```js
export async function createMcpHttpClientPlugin({
  serverName,   // string, required — used as tool namespace prefix e.g. "composio"
  url,          // string, required — e.g. "https://mcp.composio.dev/slack?api_key=..."
  headers,      // object, optional — extra HTTP headers
  prefix,       // string, optional, default "mcp"
  clientInfo,   // object, optional
  idleTimeoutMs // number, optional
})
```

**Implementation pattern** (mirror `createMcpClientPlugin` exactly, swap transport):

```js
import { StreamableHttpClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function createManagedMcpHttpSession(server, options = {}) {
  // Same structure as createManagedMcpSession but use:
  const nextTransport = new StreamableHttpClientTransport(
    new URL(server.url),
    { headers: server.headers }
  );
  // ... rest identical to createManagedMcpSession
}

export async function createMcpHttpClientPlugin({ serverName, url, headers, prefix = "mcp", clientInfo, idleTimeoutMs }) {
  if (!serverName?.trim()) throw new Error("createMcpHttpClientPlugin requires a non-empty serverName");
  if (!url?.trim()) throw new Error("createMcpHttpClientPlugin requires a url");

  const server = { serverName, url, headers, clientInfo };
  const session = createManagedMcpHttpSession(server, { idleTimeoutMs });

  const tools = await session.useClient(async (client) => {
    const result = await client.listTools();
    return result.tools ?? [];
  });

  const plugin = createMcpToolPlugin({
    serverName,
    prefix,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema ?? tool.structuredOutputSchema ?? undefined,
    })),
    callTool: async ({ name, input }) =>
      session.useClient(async (client) => client.callTool({ name, arguments: input })),
  });

  return { ...plugin, close: session.close };
}
```

**Note on `createManagedMcpHttpSession`:** Rather than duplicating the session logic,
refactor `createManagedMcpSession` to accept a `buildTransport` factory function:

```js
function createManagedMcpSession(server, options = {}, buildTransport) {
  // ...same as before but use buildTransport(server) instead of new StdioClientTransport(...)
}
```

Then both stdio and HTTP share the same idle-timeout / ref-counting logic.

### 1b — Export from `src/index.js`

```js
export { createMcpHttpClientPlugin } from "./runtime-plugins.js";
```

### 1c — Tests for `createMcpHttpClientPlugin`

Add to `test/runtime.test.js`. Use `nock` or Node's built-in `http` module to mock an
HTTP MCP server that responds to `tools/list` and `tools/call`. Keep it lightweight —
the goal is to confirm the transport wires up correctly, not to retest MCP SDK internals.

**Minimum test cases:**
- `createMcpHttpClientPlugin` discovers tools from an HTTP server
- Executes a tool call and returns normalized result
- `close()` is called on the session after the run

### 1d — Update README

Add `createMcpHttpClientPlugin` to the "Writing a Runtime" section:

```js
import { createMcpHttpClientPlugin } from "runeflow";

const plugin = await createMcpHttpClientPlugin({
  serverName: "composio",
  url: `https://mcp.composio.dev/slack?api_key=${process.env.COMPOSIO_API_KEY}`,
});

export default {
  ...createDefaultRuntime(),
  plugins: [plugin],
};
```

---

## Task 2 — Frontmatter `mcp_servers` and `composio` blocks

### Background

Right now users must write a `runtime.js` to wire up any plugin. The goal is zero-config:
declare servers in the skill frontmatter and `runeflow run` handles the rest automatically.

**Target frontmatter syntax:**

```yaml
---
name: notify-on-pr
mcp_servers:
  github:
    command: npx
    args: ["-y", "@github/mcp-server"]
  slack:
    url: "https://mcp.composio.dev/slack"
    headers:
      x-composio-api-key: "${COMPOSIO_API_KEY}"
composio:
  tools: ["GITHUB_LIST_BRANCHES", "SLACK_SEND_MESSAGE"]
  entity_id: "${COMPOSIO_ENTITY_ID}"
---
```

### 2a — Parse `mcp_servers` and `composio` in `src/parser.js`

In `parseSkill`, the `metadata` object is built from frontmatter. Extend it:

```js
// In parseSkill, add to returned metadata:
metadata: {
  name: frontmatter.name ?? null,
  description: frontmatter.description ?? null,
  version: frontmatter.version ?? "0.1",
  inputs: frontmatter.inputs ?? {},
  outputs: frontmatter.outputs ?? {},
  llm: frontmatter.llm ?? null,
  mcp_servers: frontmatter.mcp_servers ?? null,   // ADD
  composio: frontmatter.composio ?? null,          // ADD
},
```

**`mcp_servers` shape** (each value is one of):
```
{ command: string, args?: string[], env?: object }   // stdio server
{ url: string, headers?: object }                     // HTTP server
```

**`composio` shape:**
```
{
  tools?: string[],       // e.g. ["GITHUB_LIST_BRANCHES"]
  toolkits?: string[],    // e.g. ["GITHUB", "SLACK"]
  entity_id?: string,
  connected_account_id?: string
}
```

**Environment variable interpolation:** Values like `"${COMPOSIO_API_KEY}"` must be
expanded at runtime (not parse time). Add a helper `expandEnvVars(value)` in `src/utils.js`:

```js
export function expandEnvVars(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
}
```

Walk the entire `mcp_servers` / `composio` config through `expandEnvVars` recursively
before using it.

### 2b — Validate `mcp_servers` and `composio` in `src/validator.js`

Add validation for the new frontmatter fields. In `validateSkill`:

```js
if (metadata.mcp_servers !== null && metadata.mcp_servers !== undefined) {
  if (!isPlainObject(metadata.mcp_servers)) {
    issues.push("metadata.mcp_servers must be an object");
  } else {
    for (const [name, server] of Object.entries(metadata.mcp_servers)) {
      if (!isPlainObject(server)) {
        issues.push(`metadata.mcp_servers.${name} must be an object`);
        continue;
      }
      const hasCommand = typeof server.command === "string" && server.command.trim();
      const hasUrl = typeof server.url === "string" && server.url.trim();
      if (!hasCommand && !hasUrl) {
        issues.push(`metadata.mcp_servers.${name} must declare either 'command' (stdio) or 'url' (HTTP)`);
      }
      if (hasCommand && hasUrl) {
        issues.push(`metadata.mcp_servers.${name} must declare 'command' OR 'url', not both`);
      }
    }
  }
}

if (metadata.composio !== null && metadata.composio !== undefined) {
  if (!isPlainObject(metadata.composio)) {
    issues.push("metadata.composio must be an object");
  } else {
    const { tools, toolkits } = metadata.composio;
    if (tools !== undefined && !Array.isArray(tools)) {
      issues.push("metadata.composio.tools must be an array");
    }
    if (toolkits !== undefined && !Array.isArray(toolkits)) {
      issues.push("metadata.composio.toolkits must be an array");
    }
    if (!tools?.length && !toolkits?.length) {
      issues.push("metadata.composio must declare at least one of 'tools' or 'toolkits'");
    }
  }
}
```

### 2c — Auto-load plugins from frontmatter in `src/runtime.js`

In `runSkill` (the main execution entry), before `createRuntimeEnvironment` is called,
inspect the parsed definition and build plugins from frontmatter declarations.

Add a new internal function `buildFrontmatterPlugins(definition, options)`:

```js
async function buildFrontmatterPlugins(definition, options = {}) {
  const plugins = [];
  const { mcp_servers, composio } = definition.metadata;

  if (isPlainObject(mcp_servers)) {
    for (const [serverName, rawConfig] of Object.entries(mcp_servers)) {
      const config = deepWalkExpandEnvVars(rawConfig); // uses expandEnvVars helper

      if (config.url) {
        // HTTP MCP server
        const plugin = await createMcpHttpClientPlugin({
          serverName,
          url: config.url,
          headers: config.headers,
          idleTimeoutMs: config.idleTimeoutMs,
        });
        plugins.push(plugin);
      } else {
        // stdio MCP server
        const plugin = await createMcpClientPlugin({
          serverName,
          command: config.command,
          args: config.args ?? [],
          env: { ...process.env, ...(config.env ?? {}) },
          cwd: config.cwd ?? options.cwd,
          idleTimeoutMs: config.idleTimeoutMs,
        });
        plugins.push(plugin);
      }
    }
  }

  if (isPlainObject(composio)) {
    const cfg = deepWalkExpandEnvVars(composio);
    const plugin = await createComposioClientPlugin({
      tools: cfg.tools,
      toolkits: cfg.toolkits,
      executeDefaults: {
        userId: cfg.entity_id ?? cfg.user_id,
        connectedAccountId: cfg.connected_account_id,
      },
      cwd: options.cwd,
    });
    plugins.push(plugin);
  }

  return plugins;
}
```

Then in `runSkill`, merge frontmatter plugins with runtime plugins:

```js
const frontmatterPlugins = await buildFrontmatterPlugins(definition, options);
const mergedRuntime = {
  ...runtime,
  plugins: [...(runtime.plugins ?? []), ...frontmatterPlugins],
};
// then pass mergedRuntime to createRuntimeEnvironment as before
```

Make sure frontmatter plugin `close()` is called in the `finally` block of `runSkill`,
alongside the existing `closeRuntimePlugins` call.

### 2d — `runeflow validate` understands frontmatter tools

When `runeflow validate` is run, it should also build (or at minimum discover) tool names
from `mcp_servers` and `composio` so the validator can check `step.tool` references against
them. Since full plugin init (connecting MCP subprocesses) is too heavy for a static validate,
do a lightweight version: check that each `step.tool` that starts with `mcp.` has a matching
`mcp_servers` entry with that server name.

Add to `validateSkill`:

```js
// For tool steps referencing mcp.* or composio.*, cross-check frontmatter
if (step.kind === "tool" && typeof step.tool === "string") {
  const [prefix, serverName] = step.tool.split(".");
  if (prefix === "mcp" && serverName) {
    const declared = metadata.mcp_servers ?? {};
    if (!Object.prototype.hasOwnProperty.call(declared, serverName)) {
      issues.push(
        `step '${step.id}' references MCP server '${serverName}' but it is not declared in mcp_servers`
      );
    }
  }
  if (prefix === "composio" && !metadata.composio) {
    issues.push(
      `step '${step.id}' references a composio tool but 'composio' is not declared in frontmatter`
    );
  }
}
```

### 2e — Tests

Add to `test/runtime.test.js`:
- Skill with `mcp_servers` stdio entry auto-starts the server and runs the tool
- Skill with `mcp_servers` HTTP entry calls `createMcpHttpClientPlugin` (mock the HTTP server)
- Frontmatter plugins are closed after run completes
- `runeflow validate` catches missing `mcp_servers` declaration for an `mcp.*` tool

Add to `test/parser.test.js`:
- `mcp_servers` and `composio` blocks are parsed into `metadata`

Add to `test/validator.test.js`:
- Server without `command` or `url` produces an issue
- `composio` without `tools` or `toolkits` produces an issue

---

## Task 3 — `runeflow-mcp` server package

### Background

This is the reverse direction: expose Runeflow as an MCP tool so Claude Code, Cursor,
and any MCP-compatible agent can invoke a full skill with one tool call.

### 3a — Create `packages/runeflow-mcp/`

```
packages/runeflow-mcp/
  package.json
  index.js        ← the MCP server
  README.md
```

**`packages/runeflow-mcp/package.json`:**

```json
{
  "name": "runeflow-mcp",
  "version": "0.3.0",
  "description": "MCP server that exposes runeflow_run as a tool",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "bin": { "runeflow-mcp": "./index.js" },
  "dependencies": {
    "runeflow": "*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.3.6"
  }
}
```

**`packages/runeflow-mcp/index.js`:**

```js
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { parseRuneflow, runRuneflow, createDefaultRuntime, closeRuntimePlugins } from "runeflow";

const server = new McpServer({
  name: "runeflow-mcp",
  version: "0.3.0",
});

server.registerTool(
  "runeflow_run",
  {
    description:
      "Run a .runeflow.md skill file end-to-end. The runtime owns sequencing, retries, " +
      "tool calls, and schema validation. Returns structured JSON outputs and a run_id " +
      "for inspection via runeflow inspect-run.",
    inputSchema: {
      skill_path: z.string().describe("Path to the .runeflow.md skill file"),
      inputs: z.record(z.any()).optional().describe("Input values for the skill"),
      runs_dir: z.string().optional().describe("Directory for run artifacts (default: .runeflow-runs)"),
    },
  },
  async ({ skill_path, inputs = {}, runs_dir }) => {
    const absolutePath = path.resolve(skill_path);
    const source = await fs.readFile(absolutePath, "utf8");
    const definition = parseRuneflow(source, { sourcePath: absolutePath });
    const runtime = createDefaultRuntime();

    let run;
    try {
      run = await runRuneflow(definition, inputs, runtime, {
        runsDir: runs_dir,
        cwd: path.dirname(absolutePath),
      });
    } finally {
      await closeRuntimePlugins(runtime).catch(() => {});
    }

    const resultText = JSON.stringify({
      status: run.status,
      run_id: run.run_id,
      outputs: run.outputs,
      ...(run.status !== "success" ? { error: run.error } : {}),
    }, null, 2);

    return {
      content: [{ type: "text", text: resultText }],
      isError: run.status !== "success",
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### 3b — README for `runeflow-mcp`

Show how to wire it into Claude Code's MCP config (`.mcp.json`):

```json
{
  "mcpServers": {
    "runeflow": {
      "command": "npx",
      "args": ["runeflow-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

Then in Claude Code or Cursor the agent can say:

```
Use runeflow_run to run ./draft-pr.runeflow.md with inputs {"base_branch": "main"}
```

### 3c — Tests for `runeflow-mcp`

Add `test/runeflow-mcp.test.js`:

- Spawn `runeflow-mcp` as a child process, connect via stdio MCP client
- Call `runeflow_run` with a simple fixture skill
- Assert `status: "success"` and correct outputs in the response
- Assert `isError: false` on the MCP content block

---

## Task 4 — Publish `runeflow-registry` to npm

The `packages/runeflow-registry/` package already has real working implementations
of GitHub, Linear, Slack, and Notion. It just needs publishing.

### 4a — Version and publish

Set version to `0.1.0` in `packages/runeflow-registry/package.json`. Confirm all four
providers (`github`, `linear`, `slack`, `notion`) are exported from `index.js`.

### 4b — Add `runeflow-registry` to the main README

Add a new section "Official tool registry" showing the install + runtime usage pattern
that's already documented in `packages/runeflow-registry/README.md`. Link to it from
the "Built-in Tools" table.

---

## Task 5 — Small housekeeping

### 5a — Warn on dropped JSON Schema keys in `toSupportedSchema`

In `src/runtime-plugins.js`, `toSupportedSchema` silently drops `enum`, `anyOf`,
`allOf`, `oneOf`, `not`, `$ref`. A Composio tool with `enum` in its input schema
loses the constraint silently.

Add a dev-mode warning:

```js
const DROPPED_SCHEMA_KEYS = new Set(["enum", "anyOf", "allOf", "oneOf", "not", "$ref", "const"]);

function toSupportedSchema(schema, _path = "schema") {
  // ...existing logic...
  for (const [key, value] of Object.entries(schema)) {
    if (DROPPED_SCHEMA_KEYS.has(key)) {
      // Only warn in dev/debug mode to avoid noise in production
      if (process.env.RUNEFLOW_DEBUG) {
        process.stderr.write(`[runeflow] toSupportedSchema: dropping unsupported key '${key}' at ${_path}\n`);
      }
      continue;
    }
    // ...rest of existing logic
  }
}
```

### 5b — Guard no-underscore tool names in `normalizeComposioToolName`

In `src/runtime-plugins.js`, when `sourceName` has no `_`, the function currently
returns just `trimmedSourceName.toLowerCase()` with no namespace. This could collide
with builtin tool names like `file` or `util`.

```js
// Current (risky):
return trimmedSourceName.toLowerCase();

// Fix — always ensure at least a composio. namespace:
return `composio.${trimmedSourceName.toLowerCase()}`;
```

---

## Delivery order

```
1. Fix 1 + Fix 2          ← 30 min, do first, cut v0.2.1 patch
2. Task 1 (HTTP transport) ← 1 day
3. Task 5a + 5b            ← 1 hour, fold into Task 1 PR
4. Task 2 (frontmatter)    ← 2 days (parser + validator + runtime + tests)
5. Task 4 (publish registry) ← 2 hours
6. Task 3 (runeflow-mcp)   ← 1 day
```

## Files touched by each task

| Task | Files modified | Files created |
|------|---------------|---------------|
| Fix 1 | `package.json` | — |
| Fix 2 | `.gitignore` | — |
| Task 1 | `src/runtime-plugins.js`, `src/index.js`, `test/runtime.test.js`, `README.md` | — |
| Task 2 | `src/parser.js`, `src/validator.js`, `src/runtime.js`, `src/utils.js`, `test/runtime.test.js`, `test/parser.test.js`, `test/validator.test.js` | — |
| Task 3 | — | `packages/runeflow-mcp/package.json`, `packages/runeflow-mcp/index.js`, `packages/runeflow-mcp/README.md`, `test/runeflow-mcp.test.js` |
| Task 4 | `packages/runeflow-registry/package.json`, `README.md` | — |
| Task 5 | `src/runtime-plugins.js` | — |

## Key invariants to maintain

- All existing tests must pass unchanged
- `runeflow validate` must still work with no `--runtime` flag (frontmatter plugin init is lazy — don't connect to servers during static validation)
- `closeRuntimePlugins` must be called in every code path that initializes frontmatter plugins, including error paths
- Frontmatter plugins must not be initialized if the corresponding tools are never referenced in the workflow (lazy init optimization — optional for v0.3, flag as a TODO)
- The `runeflow-mcp` server must handle skill errors gracefully — a failed run should return `isError: true` with the error in the content, not crash the MCP server process
