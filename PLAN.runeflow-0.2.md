# Runeflow 0.2: Hybrid-Skill Execution Milestone

## Summary

Runeflow remains valid if it is treated as a runtime-owned execution contract for a single hybrid skill file. The LLM may see the full file for context, but it must not be responsible for understanding or enforcing the language semantics. The runtime is authoritative for control flow, retries, schema checks, tool calls, and outputs.

This milestone proves one flagship use case: local PR-prep automation for agent builders. The product claim to validate is that one Markdown file with embedded Runeflow is easier to author, inspect, and safely execute than plain Markdown instructions or a custom script.

## Key Changes

### 1. Explicit context-projection contract

- Keep one hybrid file containing prose docs plus a fenced `runeflow` block.
- At each `llm` step, pass the LLM:
  - the resolved step prompt
  - the resolved step input
  - the selected operator docs from the same file
  - prior step outputs or artifact paths only when explicitly referenced in the resolved input
- Treat the `runeflow` block as runtime-authoritative metadata, not something the LLM must interpret.
- Allow full-file visibility as ambient context, but execution must not depend on that visibility.

### 2. Interpolation for LLM-facing prompts and tool inputs

- Add `{{ ... }}` interpolation support to string-valued fields resolved at runtime.
- Support it in `prompt`, tool `with`, LLM `input`, `fail_message`, and `output`.
- Preserve existing full-string references like `steps.draft.title` and `inputs.base_branch`.
- Resolution rules:
  - exact interpolation returns native type
  - mixed strings return strings
  - multiple placeholders are allowed
- Validation must inspect interpolated references and apply the same forward-reference and schema-path checks used today.

### 3. Minimal built-in tool registry

- Make CLI `run` include built-in tools by default.
- Merge built-ins with `runtime.tools`, with user tools overriding built-ins by name.
- Keep `runtime.llm` external and required for `llm` steps.
- Built-ins in this milestone:
  - `file.exists`
  - `git.current_branch`
  - `git.diff_summary`
  - `git.push_current_branch`
  - `util.fail`
  - `util.complete`
- Git built-ins should use local `git` commands and fail with clear runtime errors when repo state is invalid.

### 4. Flagship example redesign

- Replace the current example with a local PR-prep workflow that:
  - detects a PR template
  - detects the current branch
  - summarizes the diff against `inputs.base_branch`
  - drafts PR title and body via `llm`
  - emits structured outputs for branch, title, body, and diff summary
- The example LLM runtime should show the exact contract it receives from the runtime rather than requiring it to parse the Runeflow DSL.
- Keep GitHub network operations out of 0.2.

## Public Interfaces And Behavior

- Preserve existing exports: `parseRuneflow`, `validateRuneflow`, `runRuneflow`, `importMarkdownRuneflow`.
- Preserve the current DSL structure and step kinds: `tool`, `llm`, `branch`.
- Add documented `llm` runtime behavior for:
  - `step`
  - resolved `prompt`
  - resolved `input`
  - `schema`
  - runtime `state`
  - projected docs/context
- Preserve backward compatibility:
  - existing full-string expressions keep working
  - existing run artifacts remain structurally compatible
  - no loops, recursion, arbitrary DAGs, or parallel execution

## Test Plan

- Interpolation tests:
  - exact interpolation preserves boolean, number, object, and array types
  - mixed interpolation produces strings
  - multiple placeholders resolve in order
- Validation tests:
  - interpolated paths participate in forward-reference checks
  - interpolated paths fail on unknown inputs or outputs
- Runtime tests:
  - built-in tools work without a custom tool runtime
  - user runtime tools override built-ins
  - `llm` steps receive projected docs/context and resolved prompt/input
- Git integration tests with temporary repos:
  - current branch detection
  - diff summary against a base branch
  - push to a temporary local remote
- Example acceptance:
  - `validate` passes on the flagship example
  - `run` succeeds with the sample LLM runtime
  - output artifact contains branch metadata and drafted PR content

## Follow-Up Notes

- Standardize LLM provider invocation so each adapter follows one shared contract for prompt assembly, structured JSON output, model selection, and router behavior.
