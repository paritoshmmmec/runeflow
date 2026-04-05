# Evaluation Assets

This directory holds prototype evaluation assets for comparing:

- raw Markdown-only skills
- Runeflow workflows

The goal is to keep benchmark scaffolding separate from product examples.

Recommended layout:

- benchmark-specific raw baselines
- benchmark-specific Runeflow workflows
- local mock runtimes
- comparison harnesses
- benchmark notes and scoring guidance

Current assets:

- [open-pr.raw.md](/Users/paritosh/src/skill-language/eval/open-pr.raw.md): raw baseline for PR drafting
- [open-pr.js](/Users/paritosh/src/skill-language/eval/open-pr.js): comparison harness for PR drafting
- [mock-runtime.js](/Users/paritosh/src/skill-language/eval/mock-runtime.js): local mock runtime for evaluation
- [utils.js](/Users/paritosh/src/skill-language/eval/utils.js): token accounting and LLM-call tracking helpers
- [stale-pr-triage.raw.md](/Users/paritosh/src/skill-language/eval/stale-pr-triage.raw.md): raw multi-turn benchmark baseline
- [stale-pr-triage.runeflow.md](/Users/paritosh/src/skill-language/eval/stale-pr-triage.runeflow.md): matching Runeflow benchmark
- [3p-updates.raw.md](/Users/paritosh/src/skill-language/eval/3p-updates.raw.md): raw baseline adapted from an Anthropic skill example
- [3p-updates.runeflow.md](/Users/paritosh/src/skill-language/eval/3p-updates.runeflow.md): matching Runeflow benchmark for the same task
- [3p-updates.js](/Users/paritosh/src/skill-language/eval/3p-updates.js): harness for the 3P benchmark
- [3p-runtime.js](/Users/paritosh/src/skill-language/eval/3p-runtime.js): mock workplace tools plus provider-backed drafting runtime

This folder is intentionally prototype-oriented. It should optimize for clarity and repeatability, not polished benchmark infrastructure.
