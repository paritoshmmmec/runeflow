Mostly polish, with a small number of focused builds.

**Build Next**

- `runeflow test` should be a real priority. If Runeflow’s promise is reliability, users need a way to lock workflow behavior and catch regressions.
- Cross-file composition/imports are worth building because they support reuse without changing the mental model.
- Make `assemble` a first-class feature. This feels like the sharpest differentiator for agent workflows, so it deserves stronger UX and docs.
- Improve skill discovery and repo-local conventions around `.runeflow/skills/`. That helps teams adopt it as infrastructure, not just examples.

**Polish Hard**

- Quickstart and install flow. Reduce provider/runtime friction and avoid exposing internal paths where possible.
- Error messages and validation output. This is one of the biggest DX multipliers for a tool like this.
- `init` quality. It should reliably generate something users actually keep, not just inspect once.
- Docs positioning. The README should lead with the core use case and stop feeling like a platform catalog.
- Examples. Invest in 4-5 excellent canonical workflows for PRs, review, release notes, issue triage, and agent pre-processing.
- Run inspection. Artifacts are valuable, but the experience should feel obvious and useful, not merely available.

**Delay For Now**

- Remote execution
- Web dashboard
- Broader scheduling/watch expansion
- More orchestration primitives beyond the current narrow model
- Large integrations surface unless they clearly strengthen the core dev-workflow story

If I had to rank the next wave, I’d do this:

1. `runeflow test`
2. `assemble` polish and positioning
3. imports/composition
4. docs/examples/init polish
5. better inspection/error UX

The short version: build features that make Runeflow more trustworthy and reusable; polish everything that affects first-run clarity and everyday adoption. Avoid building “platform” features until the core loop is sticky.