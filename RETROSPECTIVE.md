# Runeflow Prototype Retrospective

## What Worked

- The core thesis held up: a skill can be an executable behavior contract, not just prompt text.
- The runtime-owned model was the right split. Control flow, validation, retries, and artifacts stayed deterministic while the LLM handled bounded generation.
- The single hybrid file format worked in practice. It stayed readable for humans while still giving the runtime enough structure to execute.
- Built-in local tools were enough to make the examples feel real rather than toy-only.
- The idea generalized across at least two tasks: PR drafting and review drafting.

## What Surprised Us

- The model boundary became much clearer once we ran it for real. The LLM did not need to understand the language for the system to work.
- Live runs were more useful than expected for shaping the product story. The system behavior itself made the value proposition easier to explain.
- The second skill mattered a lot. Once review drafting worked, the concept felt less like a single demo and more like a reusable pattern.
- Real-model integration surfaced practical issues quickly, like model availability and output shaping, which was helpful.

## What To Build Next

- Add richer repo context tools, especially patch- or file-level diff access, so review-style skills can be more than high-level summaries.
- Add an explicit no-op path for empty diffs so the flagship PR-prep example behaves more like a real operator tool.
- Build one more high-value skill in a different category, like issue-to-plan or release-notes drafting.
- Improve example quality and docs so a new user can get from `.env` to a successful real run with minimal friction.
- Identify the smallest repeatable workflow set that makes Runeflow feel necessary, not just interesting.

## What Not To Build Yet

- Do not turn this into a full orchestration engine.
- Do not add loops, arbitrary DAGs, or heavy scheduling features yet.
- Do not over-invest in broad DSL expressiveness before the highest-value workflows are clearer.
- Do not make the model responsible for execution semantics.
- Do not position the project as generic skill chaining; the stronger story is runtime-owned executable skills.

## Bottom Line

The prototype answered the most important early question: the idea is real.

The next step is no longer proving that Runeflow can work. The next step is finding the smallest product shape that makes people want to keep using it.

## End-To-End Flow

This is the intended lifecycle of a Runeflow skill from authoring to execution.

1. Author writes one hybrid skill file.
   - The file contains frontmatter, human-facing Markdown docs, and a fenced `runeflow` block.
2. Host loads the skill.
   - The host parses the docs and executable block separately from the same file.
3. Runtime validates the contract.
   - It checks metadata, step kinds, references, targets, and output shapes before execution begins.
4. Runtime starts a run.
   - A run id is created, inputs are recorded, and the run artifact enters `running` state.
5. Runtime executes each step in order.
   - `tool` steps call deterministic tools.
   - `llm` steps call the model with resolved prompt and resolved input.
   - `branch` steps choose the next target.
6. Runtime projects only the needed context to the `llm` step.
   - The model receives the current step, resolved prompt, resolved input, schema, state, and projected docs/context.
   - The model is not responsible for parsing or enforcing Runeflow semantics.
7. Runtime validates and persists each step result.
   - Outputs are checked against the step schema.
   - Each step writes its own JSON artifact.
8. Runtime handles failure paths.
   - Retries, fallbacks, and terminal failures are enforced by the runtime.
9. Runtime resolves final outputs.
   - The `output` block is evaluated and validated against declared output schema.
10. User inspects the result.
   - The completed run artifact and step artifacts make the whole execution visible and debuggable.

## Why This Matters

Runeflow separates three concerns clearly:

- Human layer: the Markdown explains intent and operating guidance.
- Runtime layer: the engine owns sequencing, validation, retries, and artifacts.
- LLM layer: the model performs bounded generation inside typed steps.

That separation is the point. If the model had to understand and enforce the whole workflow, the system would collapse back into prompt engineering with extra syntax.
