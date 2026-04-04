# Tool Registry

This directory is a prototype in-repo registry for popular tool contracts.

The goal is simple:

- make tool inputs and outputs discoverable
- support authoring without reading implementation code
- give validation a stable source of truth
- learn what metadata matters before building a larger registry story

Each tool contract is hand-authored JSON for now. That is intentional. The prototype should optimize for clarity, not automation.

Current focus:

- GitHub workflows
- Linear workflows

Each entry should contain:

- `name`
- `description`
- `tags`
- `inputSchema`
- `outputSchema`
- optional `examples`

Registry-backed tool steps can now omit `out` and use the registry `outputSchema` as their default output contract.

This is still not the full runtime registry story. It is the first authoring and validation data set.
