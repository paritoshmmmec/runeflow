# Runeflow Evaluation Plan

## Goal

Evaluate whether Runeflow is better than raw Markdown-only skills for real prototype workflows.

We want to answer two questions:

1. Does Runeflow reduce token usage by projecting only the context needed for the current step?
2. Does Runeflow improve output reliability and task quality by moving execution semantics out of the prompt and into the runtime?

This plan compares two modes:

- `raw skill`: the host loads a Markdown skill into model context and relies mostly on prompt discipline
- `runeflow`: the host executes a hybrid file and the model only participates inside bounded `llm` steps

## Why This Is Worth Testing

The evaluation is grounded in three ideas:

- long or noisy context can make it harder for models to use the most relevant information
- explicit tool use can improve task performance
- schema-constrained outputs improve formatting reliability

These are not yet direct proof for Runeflow itself. They are reasons to expect the experiment to be worth running.

Reference points:

- [Lost in the Middle](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00638/119630/Lost-in-the-Middle-How-Language-Models-Use-Long)
- [Toolformer](https://arxiv.org/abs/2302.04761)
- [OpenAI Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/)

## Hypotheses

### H1

Runeflow reduces input tokens for multi-step workflows because the model sees only step-local context rather than the whole skill every time.

### H2

Runeflow improves schema-valid output rate because tool and `llm` outputs are runtime-validated.

### H3

Runeflow improves end-task success rate for tool-heavy workflows because execution order and tool contracts are explicit.

### H4

Runeflow may not show large gains for short, one-shot, text-heavy tasks.

## Modes To Compare

### Mode A: Raw Skill

- one Markdown skill document
- full skill loaded into the model context
- model decides how to interpret instructions and use tools
- output correctness relies mostly on prompting

### Mode B: Runeflow

- hybrid Markdown + `runeflow` file
- runtime controls sequencing, branching, retries, and validation
- model only sees the current-step prompt, resolved inputs, and selected docs
- tool and `llm` outputs are validated

## Benchmark Task Set

Use a small but representative set of workflows.

### Tool-heavy tasks

- count open PRs in a repository
- list stale PRs older than N days
- count backlog issues in a Linear team
- list unassigned or backlog issues for a team

### Mixed tasks

- summarize stale PRs and draft a maintainer update
- turn a set of Linear issues into a short execution plan
- draft a PR description from repo context
- draft code review notes from repo context

### Text-heavy tasks

- release notes draft
- weekly engineering summary
- status update from issue and PR context
- 3P updates from workplace context

## Suggested First Evaluation Slice

Start with 3 workflows:

1. GitHub: count open PRs and summarize stale ones
2. Linear: count backlog issues and list top candidates
3. Mixed: combine GitHub + Linear into a short execution summary

Run each workflow in both modes with the same model and the same input data.

## Metrics

### Cost and efficiency

- total input tokens per run
- total output tokens per run
- total tokens per successful run
- retries per successful run
- latency per run when provider quotas and rate limits are controlled

### Reliability

- schema-valid output rate
- tool-call success rate
- runtime failure rate
- malformed output rate

### Outcome quality

- end-task success rate
- human-graded usefulness score
- rubric-based completeness score
- factual accuracy for tool-derived claims

## Evaluation Rubric

For each completed run, score:

- `success`: did it complete the intended task?
- `valid`: did it satisfy the required schema?
- `correct`: were the key factual outputs correct?
- `useful`: would an operator actually use this result?

Use a simple 0/1 score for `success`, `valid`, and `correct`.
Use a 1-5 score for `useful`.

## Experimental Design

### Controls

- same model
- same temperature
- same input data
- same tool backends
- same evaluation rubric
- same delay / sequencing strategy when providers have strict token-per-minute limits

### Repetitions

- run each task at least 10 times in each mode
- use more repetitions if model variance is high

### Logging

Capture for every run:

- mode
- workflow id
- model
- inputs
- prompt/context size
- tool calls
- token counts
- outputs
- validation status
- retries
- final score

## What Counts As A Win

Runeflow looks promising if it shows at least one strong advantage on meaningful workflows:

- lower total tokens per successful run
- higher schema-valid rate
- higher end-task success rate
- lower malformed-output rate

The most likely early win is reliability, not raw token savings.

## Likely Failure Cases

The idea may be weaker than expected if:

- token savings are small because projected context is still too large
- raw skills perform similarly on short workflows
- the cost of runtime structure outweighs the benefits for simple tasks
- authoring overhead stays too high even with the registry

## Instrumentation Work Needed

To run this evaluation well, we likely need:

- token accounting per `llm` step
- saved run metadata for prompts and selected docs
- a raw-skill runner for baseline comparisons
- a lightweight scoring harness

## Near-Term Execution Plan

1. Pick the first 3 benchmark workflows.
2. Build raw-skill baselines for each.
3. Build equivalent Runeflow versions.
4. Add logging for token usage, retries, and validation outcomes.
5. Run both modes repeatedly.
6. Compare success, validity, usefulness, and cost.

## Current Scaffold

The repo now includes a first comparison scaffold for the PR-drafting workflow:

- raw baseline: [eval/open-pr.raw.md](/Users/paritosh/src/skill-language/eval/open-pr.raw.md)
- runeflow version: [examples/open-pr.runeflow.md](/Users/paritosh/src/skill-language/examples/open-pr.runeflow.md)
- evaluation harness: [eval/open-pr.js](/Users/paritosh/src/skill-language/eval/open-pr.js)
- mock runtime for local testing: [eval/mock-runtime.js](/Users/paritosh/src/skill-language/eval/mock-runtime.js)
- simple multi-turn benchmark: [eval/stale-pr-triage.runeflow.md](/Users/paritosh/src/skill-language/eval/stale-pr-triage.runeflow.md)
- matching raw baseline: [eval/stale-pr-triage.raw.md](/Users/paritosh/src/skill-language/eval/stale-pr-triage.raw.md)
- raw workplace-writing benchmark: [eval/3p-updates.raw.md](/Users/paritosh/src/skill-language/eval/3p-updates.raw.md)
- matching Runeflow workplace-writing benchmark: [eval/3p-updates.runeflow.md](/Users/paritosh/src/skill-language/eval/3p-updates.runeflow.md)

Run it with:

```bash
npm run eval:open-pr
```

Override the runtime to use a real provider-backed implementation when needed:

```bash
node ./eval/open-pr.js --base-branch main --runtime ./examples/open-pr-runtime.js
```

Useful flags for provider-limited evaluations:

```bash
node ./eval/open-pr.js --mode raw
node ./eval/open-pr.js --mode runeflow
node ./eval/open-pr.js --mode both --delay-ms 8000 --model llama3.1-8b --runtime ./examples/open-pr-runtime.js
```

The current token counts use `tiktoken` for estimation. They are much better than character-based heuristics, but they should still not be treated as provider-billed usage.

Latency should be treated as a secondary metric when running against quota-limited hosted models. Under strict token-per-minute limits, sequential execution and cooldown delays matter more than raw wall-clock time.

## Output We Want

At the end of the first evaluation cycle, we should be able to answer:

- Does Runeflow reduce tokens in multi-step workflows?
- Does Runeflow improve reliability enough to justify the extra structure?
- Which workflow shapes benefit the most?
- Where does plain Markdown still perform just as well?
