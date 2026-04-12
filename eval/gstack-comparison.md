# g-stack vs Runeflow: Token Comparison

Comparing two g-stack skills (ship, review) against their Runeflow equivalents.
Token estimates use the ~4 chars/token approximation (GPT-4 tokenizer).

---

## ship

| | [g-stack ship/SKILL.md](https://github.com/garrytan/gstack/blob/main/ship/SKILL.md) | Runeflow examples/ship.md |
|---|---|---|
| Lines | 2,543 | ~80 (runeflow block) |
| Characters | 128,531 | ~2,800 |
| **Est. input tokens** | **~32,100** | **~700** |
| **Reduction** | baseline | **~-98%** |

### What g-stack sends to the LLM

The entire `ship/SKILL.md` is loaded as a system prompt or preamble on every
invocation. This includes:

- ~80 lines of bash preamble (telemetry, session tracking, update checks,
  routing prompts, proactive behavior config, lake intro, CLAUDE.md setup)
- Step-by-step instructions for 8+ major phases (tests, review, version bump,
  CHANGELOG, commit splitting, push, PR creation, doc sync)
- Embedded specialist dispatch logic, confidence calibration tables, fix-first
  heuristics, Greptile triage, adversarial review (Claude + Codex subagents),
  cross-model synthesis, learnings logging, TODOS cross-reference
- Full PR body template with 12 sections

The LLM must read and interpret all of this before doing anything.

### What Runeflow sends to the LLM

Two focused LLM steps, each receiving only what they need:

**`review` step** (~350 tokens):
- Resolved prompt with actual branch name, file list, diff summary
- Output schema: `{ issues, verdict, safe_to_ship }`

**`draft_changelog` step** (~300 tokens):
- Resolved prompt with actual commits, diff summary, current version
- Output schema: `{ new_version, entry, bump_type }`

Everything else (git commands, file writes, push, PR creation) runs as
deterministic `tool` and `cli` steps — zero LLM tokens.

---

## review

| | [g-stack review/SKILL.md](https://github.com/garrytan/gstack/blob/main/review/SKILL.md) | Runeflow examples/review-pr.md |
|---|---|---|
| Lines | 1,467 | ~70 (runeflow block) |
| Characters | 75,661 | ~2,400 |
| **Est. input tokens** | **~18,900** | **~600** |
| **Reduction** | baseline | **~-97%** |

### What g-stack sends to the LLM

The full `review/SKILL.md` on every invocation:

- Preamble bash (same session/telemetry/routing boilerplate as ship)
- Plan completion audit with full output format spec
- Greptile triage fetch/filter/classify/escalation algorithm
- Specialist dispatch logic for 7 specialists + red team
- Parallel subagent orchestration instructions
- Fingerprint dedup algorithm, confidence gate table
- PR Quality Score formula
- Fix-First heuristic (AUTO-FIX vs ASK classification)
- Adversarial review (Claude subagent + Codex adversarial + Codex structured)
- Cross-model synthesis format
- TODOS cross-reference, documentation staleness check
- Learnings logging schema and rules

### What Runeflow sends to the LLM

Two focused LLM steps:

**`critical_pass` step** (~400 tokens):
- Resolved prompt with actual branch, files, diff, scope signals
- Output schema: `{ findings, critical_count, informational_count, verdict, quality_score, safe_to_ship }`

The scope detection (`transform` step) runs in JS — zero tokens.
The branch routing runs in the runtime — zero tokens.

---

## Why the gap is so large

g-stack is a **prompt-as-program** architecture. All orchestration logic lives
inside the markdown file that gets loaded into the LLM context. The LLM reads
the entire workflow definition, decides what to do next, calls tools, reads
results, and loops. This is powerful and flexible, but every invocation pays
the full context cost regardless of which step is actually executing.

Runeflow is a **runtime-as-orchestrator** architecture. The runtime owns
sequencing, branching, tool dispatch, and artifact writing. The LLM only sees
the resolved prompt for the specific step it needs to execute — no DSL, no
orchestration instructions, no tool wiring.

The tradeoff:

| | g-stack | Runeflow |
|---|---|---|
| Authoring | Freeform prose + bash | Typed DSL |
| Orchestration | LLM decides | Runtime owns |
| Adaptability | High (LLM can improvise) | Lower (explicit steps only) |
| Token cost per run | Full file every time | Per-step prompt only |
| Debuggability | Inspect conversation | Inspect step artifacts |
| Reproducibility | Varies by model | Deterministic tool steps |

g-stack's approach makes sense for Claude Code where the LLM is the executor
and improvisation is a feature. Runeflow's approach makes sense for automated
pipelines where reproducibility and cost matter more than flexibility.

---

## Notes on the Runeflow examples

`examples/ship.md` and `examples/review-pr.md` are intentionally simplified
relative to g-stack. They cover the core happy path:

- `ship.md`: diff → review → changelog draft → version bump → push → PR
- `review-pr.md`: diff → scope detection → critical pass → structured output

What they don't cover (and g-stack does):
- Specialist subagents (testing, security, performance, data-migration, etc.)
- Adversarial cross-model review (Codex)
- Learnings persistence and retrieval
- TODOS.md cross-reference
- Greptile comment triage
- Session telemetry and update checks

These could be added as additional `llm` steps or `parallel` blocks, each
still paying only their own prompt cost rather than the full file cost.
