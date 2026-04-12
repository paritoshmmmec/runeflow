# Changelog

All notable changes to Runeflow are documented here.

---

## [0.5.1-alpha] — 2026-04-12

### Fixed
- README examples table now links to correct `.md` filenames
- All CLI and prose examples updated to use plain `.md` (preferred convention)
- Dead link to `plans/ROADMAP.md` removed from CONTRIBUTING.md
- `benchmark_report.md` added to npm `files` so it ships with the package

### Changed
- Version bumped to `0.5.1-alpha` across `runeflow`, `runeflow-mcp`, and `runeflow-registry`

---

## [0.5.0-alpha] — initial alpha release

### Added
- Full step kinds: `tool`, `llm`, `cli`, `transform`, `branch`, `parallel`, `block`, `human_input`, `fail`
- CLI: `validate`, `dryrun`, `run`, `resume`, `test`, `assemble`, `watch`, `inspect-run`, `build`, `init`, `import`, `tools`, `skills`
- Default runtime with 6 provider support via Vercel AI SDK (Cerebras, OpenAI, Anthropic, Groq, Mistral, Google)
- MCP server mode via `runeflow-mcp`
- Official tool registry via `runeflow-registry` (GitHub, Linear, Slack, Notion)
- Zero-config `mcp_servers` and `composio` frontmatter wiring
- `runeflow assemble` preprocessor — up to 82% input token reduction for agent workflows
- OTLP telemetry via `--telemetry` flag
- `runeflow test` with fixture-based mocking and `--record-fixture` capture
- `runeflow resume` for halted runs
- `runeflow watch` with cron and file-change triggers
- Plugin system: `createMcpClientPlugin`, `createMcpHttpClientPlugin`, `createComposioClientPlugin`
- Full TypeScript type definitions (`index.d.ts`)
- 322 passing tests
