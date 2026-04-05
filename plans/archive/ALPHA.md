# Runeflow Alpha Roadmap

## Goal

Ship a public alpha focused on getting feedback on the hybrid skill model. The runtime is proven. The benchmark data is compelling. The goal is not feature completeness — it is getting real users building real skills so we learn what matters next.

Known rough edges are acceptable if documented. Blocking gaps are anything that prevents a new user from understanding the model, running an example, or authoring their first skill.

---

## What's Already Alpha-Ready

- Runtime: `tool`, `llm`, `branch`, `transform` steps, `retry`, `fallback`, `fail`
- Lifecycle hooks: `beforeStep`, `afterStep`, `onStepError`
- Named doc blocks (`:::guidance[name]:::`) with per-step projection
- Validator with reference checking and schema validation
- Built-in tools: `git.*`, `file.exists`, `util.*`
- Tool registry: GitHub and Linear schemas
- CLI: `validate`, `run`, `inspect-run`, `import`
- 4 benchmarks with real token reduction data
- 5 example/eval skills

---

## Alpha Milestones

### M1 — Onboarding (must-have)

The single biggest blocker for a new user is not knowing what tools exist or what their schemas look like. Without this, authoring a skill requires reading source code.

- `runeflow tools list` — list all available tools (built-ins + registry)
- `runeflow tools inspect <tool>` — show input schema, output schema, description
- README rewrite: "what it is → why it matters → running in 5 minutes" flow
- `.env.example` with clear provider setup instructions

### M2 — Third Example Skill (must-have)

Two examples prove a demo. Three examples prove a pattern. The third skill should be in a different category from PR prep and review draft.

Candidates:
- **Release notes drafting** — fetch commits/PRs since last tag, draft structured release notes
- **Incident summary** — fetch recent errors/alerts, draft a postmortem summary
- **Issue-to-plan** — take a GitHub issue, draft an implementation plan

Pick one. Keep it realistic, not toy.

### M3 — `skip_if` on Steps (nice-to-have)

Lightweight condition to bypass a step without a full `branch`. Covers the "no diff, no PR" pattern that comes up constantly.

```
step draft_pr type=llm {
  skip_if: steps.diff.files == 0
  prompt: "Draft a PR."
  schema: { title: string, body: string }
}
```

Step is skipped cleanly, outputs are null, downstream steps that reference it get null values. No branch step needed for simple guard conditions.

### M4 — Error Message Quality (nice-to-have)

Validator errors are functional but terse. Alpha users will hit them constantly.

- "step 'draft' docs references unknown block 'pr-tone'" → suggest available block names
- "unknown step output path 'steps.fetch.items'" → suggest the step's actual output fields
- "metadata.llm is required" → explain which steps need it and why

### M5 — Known Rough Edges Doc (must-have)

A short `KNOWN_ISSUES.md` or alpha notes section in README covering:
- No skill composition/imports yet
- No parallel steps
- `transform` expr is not sandboxed from host globals (known, intentional for now)
- Tool registry is hand-maintained, not auto-generated
- CLI `run` output is raw JSON (no pretty-print mode yet)

---

## What's Explicitly Out of Alpha Scope

- Skill composition / imports (Phase 0.4)
- Parallel step execution
- Web-based skill editor or registry UI
- Hosted runtime or cloud execution
- Package registry / npm publish (alpha ships as a git clone)

---

## Alpha Success Criteria

- A new user can clone the repo, run `npm install`, and get a successful `runeflow run` on an example in under 10 minutes
- A new user can author a simple two-step skill (one tool, one llm) without reading source code
- At least one external user has built a skill that isn't in the examples directory
- Feedback has surfaced at least one thing we would not have predicted from internal use

---

## Sequence

```
M1 (tools CLI + README)  →  M2 (third example)  →  M5 (known issues doc)  →  ship alpha
                                                          ↓
                                              M3 + M4 as fast-follows
```

M1 and M2 are the gate. M5 is a day of writing. M3 and M4 can ship in the first week after alpha launch.
