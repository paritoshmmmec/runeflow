**Product Memo**

Runeflow should be positioned as a developer workflow tool, not a general AI orchestration platform. The core promise is simple: write executable skills in Markdown, keep control flow in the runtime, and give agents only the context they need. That is a strong, differentiated story because it solves a real problem teams already feel: prompt-based automations are hard to trust, hard to review, and hard to maintain.

The best near-term wedge is repo-local developer workflows with light-to-moderate AI involvement: PR drafting, code review summaries, release notes, issue creation, CI/support tasks, and agent pre-processing. These are frequent, easy to demo, and benefit directly from typed outputs, validation, and artifacts.

**ICP**

Primary user:
- Developer experience engineers
- AI platform engineers inside product teams
- Staff/full-stack engineers automating repo workflows
- Agent-heavy developers using Codex, Claude Code, or Cursor

Best-fit team traits:
- Already writing prompts, scripts, or ad hoc agent instructions
- Frustrated by brittle tool use and inconsistent outputs
- Comfortable with Markdown and CLI workflows
- Wants repo-native, diffable automation rather than a hosted platform

Not the initial target:
- Non-technical operations teams
- Large BPM/workflow-engine buyers
- Teams needing visual builders, approvals, or enterprise orchestration
- Users wanting autonomous long-running agents with complex planning

**Positioning**

Category:
- Executable Markdown workflows for AI-assisted developer tasks

Positioning statement:
- Runeflow is a small runtime for building executable AI skills in Markdown. It keeps control flow, validation, and tool execution out of prompts so workflows are readable, testable, and reliable.

Differentiators:
- Hybrid Markdown plus executable block in one file
- Runtime-owned control flow instead of prompt-owned orchestration
- Typed schemas and preflight validation
- Repo-local artifacts and inspectable runs
- Strong fit for agent pre-processing via `assemble`

What to emphasize:
- “Readable by humans, executable by runtime”
- “Use AI where it helps, not where it should be doing orchestration”
- “Works well with existing agents instead of replacing them”

What to de-emphasize:
- Platform sprawl
- Generic workflow automation
- Full agent framework comparisons
- Remote execution and dashboard ambitions, for now

**Homepage Messaging**

Hero headline:
- Stop putting workflow logic inside prompts

Hero subhead:
- Runeflow lets you build executable AI skills in Markdown. Keep guidance readable, control flow typed, and execution owned by the runtime.

Primary CTA:
- Build Your First Runeflow

Secondary CTA:
- See PR Draft Example

Three-value section:
- Readable: Markdown-first workflows live in your repo and review cleanly in diffs.
- Reliable: Validation, schemas, retries, and branching happen before tokens are wasted.
- Agent-friendly: Precompute context and hand agents only the step they need.

Suggested homepage structure:
1. Hero
2. Problem: prompt orchestration breaks
3. 3-step example: docs + runeflow block + structured output
4. “Why this works” with validation/artifacts/assemble
5. Use cases for dev workflows
6. Short comparison vs raw prompts and agent-only setups
7. Quickstart
8. Examples

**What Runeflow Is / Is Not**

Runeflow is:
- A small workflow runtime for executable AI skills
- A way to mix human guidance with typed execution
- A strong fit for repo-local automation and agent pre-processing
- A tool for deterministic setup plus bounded LLM work

Runeflow is not:
- A general-purpose DAG engine
- A no-code automation platform
- A multi-agent autonomy framework
- A replacement for app backends or job systems
- A visual workflow builder

**Product Boundaries**

Good scope for the next phase:
- Validation
- Testing
- Cross-file composition/imports
- Better examples
- Stronger `assemble`
- Better ergonomics around runtimes and tools

Risky scope to push later:
- Remote execution
- Web dashboards
- Broad scheduling/server features
- Expanding into complex orchestration primitives
- Becoming an abstraction layer over every external tool ecosystem

**Narrative To Repeat**

The most effective narrative is:

- Prompts are good for judgment and language.
- Prompts are bad places to hide workflow logic.
- Runeflow puts workflow logic back in code, while keeping authoring lightweight and human-readable.

If you want, I can turn this into a concrete rewrite for [README.md](/Users/paritosh/src/skill-language/README.md): hero, opening sections, and a tighter homepage-style narrative.