# runeflow-mcp

MCP server that exposes `runeflow_run` and `runeflow_validate` as tools. Lets Claude Code, Cursor, Codex, or any MCP-compatible agent execute Runeflow skills directly.

## Install

```bash
npm install -g runeflow-mcp
# or as a project dependency
npm install runeflow-mcp
```

## Add to your MCP config

**Claude Code** (`.mcp.json` in your project root):

```json
{
  "mcpServers": {
    "runeflow": {
      "command": "npx",
      "args": ["runeflow-mcp"],
      "env": {
        "CEREBRAS_API_KEY": "${CEREBRAS_API_KEY}"
      }
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "runeflow": {
      "command": "node",
      "args": ["node_modules/runeflow-mcp/index.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}"
      }
    }
  }
}
```

## Tools exposed

### `runeflow_run`

Run a `.runeflow.md` skill file end-to-end.

| Input | Type | Description |
|---|---|---|
| `skill_path` | string | Path to the skill file |
| `inputs` | object | Input values for the skill |
| `runs_dir` | string | Optional artifact directory |

Returns `{ status, run_id, outputs }` — or `{ status, run_id, error }` on failure.

**Example prompt to Claude Code:**
> Use runeflow_run to run ./draft-pr.runeflow.md with inputs `{"base_branch": "main"}`

### `runeflow_validate`

Validate a skill file without running it. Returns `{ valid, issues, warnings }`.

**Example prompt:**
> Use runeflow_validate to check ./draft-pr.runeflow.md

## How it works

```
Claude Code / Cursor
      ↓  MCP tool call: runeflow_run
runeflow-mcp server
      ↓  parseRuneflow + runRuneflow
Runeflow runtime (owns all execution)
      ↓  tool steps, LLM steps, branching
Structured JSON outputs
      ↑  returned to agent
```

The agent never sees the skill internals. It just gets back the structured outputs. This is the -82% token reduction story — the agent doesn't need to understand the workflow, it just calls the tool.

## License

MIT
