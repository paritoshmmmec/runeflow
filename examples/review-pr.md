---
name: review-pr
description: |
  Review a branch diff for critical issues: security, data safety, race conditions,
  and schema mismatches. Classifies findings by severity and outputs a structured
  report. Use before shipping or as a standalone pre-landing gate.
version: 0.1
inputs:
  base_branch: string
outputs:
  verdict: string
  critical_count: number
  findings: [string]
  quality_score: number
llm:
  provider: cerebras
  model: qwen-3-235b-a22b-instruct-2507
---

# Pre-Landing Code Review

You are a senior engineer doing a pre-landing review. Focus on real problems only:
- SQL injection, shell injection, auth bypass
- Race conditions and concurrency bugs
- Data loss or silent corruption
- Schema mismatches between LLM output and DB writes
- Unhandled error paths that swallow failures

Do NOT flag style issues, naming preferences, or things that are already handled
in the diff. One line per finding. Be terse.

```runeflow
step branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step diff type=tool {
  tool: git.diff_summary
  with: { base: inputs.base_branch }
  out: { base: string, summary: string, files: [string], insertions: number, deletions: number }
}

step scope type=transform {
  input: steps.diff.files
  expr: |
    ({
      has_auth: input.some(f => f.includes('auth') || f.includes('session') || f.includes('token')),
      has_migrations: input.some(f => f.includes('migrat') || f.includes('schema')),
      has_api: input.some(f => f.includes('api') || f.includes('route') || f.includes('controller')),
      is_large: input.length > 10
    })
  out: { has_auth: boolean, has_migrations: boolean, has_api: boolean, is_large: boolean }
}

step critical_pass type=llm {
  prompt: |
    Review this diff for CRITICAL issues only.
    Branch: {{ steps.branch.branch }} → {{ inputs.base_branch }}
    Files: {{ steps.diff.files }}
    Diff: {{ steps.diff.summary }}
    Scope signals — auth: {{ steps.scope.has_auth }}, migrations: {{ steps.scope.has_migrations }}, api: {{ steps.scope.has_api }}

    For each finding output: [SEVERITY] file:line — description. Fix: one-line recommendation.
    If no issues: output "CLEAN".
  input: {
    diff: steps.diff.summary,
    files: steps.diff.files,
    scope: steps.scope
  }
  schema: {
    findings: [string],
    critical_count: number,
    informational_count: number,
    verdict: string,
    quality_score: number,
    safe_to_ship: boolean
  }
}

branch check_safe {
  if: steps.critical_pass.safe_to_ship == true
  then: done
  else: done
}

step done type=tool {
  tool: util.complete
  with: {
    verdict: steps.critical_pass.verdict,
    critical_count: steps.critical_pass.critical_count,
    findings: steps.critical_pass.findings,
    quality_score: steps.critical_pass.quality_score
  }
  out: {
    verdict: string,
    critical_count: number,
    findings: [string],
    quality_score: number
  }
}

output {
  verdict: steps.done.verdict
  critical_count: steps.done.critical_count
  findings: steps.done.findings
  quality_score: steps.done.quality_score
}
```
