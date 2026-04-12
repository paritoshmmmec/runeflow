---
name: 3p-updates
description: Runeflow benchmark for writing a 3P update from workplace context.
version: 0.1
inputs:
  team_name: string
  period_label: string
outputs:
  emoji: string
  progress: string
  plans: string
  problems: string
  formatted: string
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# 3P Updates

Use this benchmark to compare a strong raw skill against a runtime-owned workflow.

The workflow should gather context from common workplace sources first, then ask the model to draft the final 3P update in a strict format.

```runeflow
step gather_slack type=tool {
  tool: slack.collect_team_updates
  with: {
    team_name: inputs.team_name,
    period_label: inputs.period_label
  }
  out: {
    highlights: [string]
  }
}

step gather_drive type=tool {
  tool: gdrive.collect_team_docs
  with: {
    team_name: inputs.team_name,
    period_label: inputs.period_label
  }
  out: {
    highlights: [string]
  }
}

step gather_email type=tool {
  tool: email.collect_team_threads
  with: {
    team_name: inputs.team_name,
    period_label: inputs.period_label
  }
  out: {
    highlights: [string]
  }
}

step gather_calendar type=tool {
  tool: calendar.collect_team_events
  with: {
    team_name: inputs.team_name,
    period_label: inputs.period_label
  }
  out: {
    highlights: [string]
  }
}

step draft_3p type=llm {
  prompt: |
    Write a concise 3P update for the {{ inputs.team_name }} team covering {{ inputs.period_label }}.

    Keep it readable in 30-60 seconds.
    Be matter-of-fact and data-driven.
    Return an emoji plus concise Progress, Plans, and Problems sections.
  input: {
    team_name: inputs.team_name,
    period_label: inputs.period_label,
    slack_highlights: "{{ steps.gather_slack.highlights }}",
    drive_highlights: "{{ steps.gather_drive.highlights }}",
    email_highlights: "{{ steps.gather_email.highlights }}",
    calendar_highlights: "{{ steps.gather_calendar.highlights }}"
  }
  schema: {
    emoji: string,
    progress: string,
    plans: string,
    problems: string,
    formatted: string
  }
}

output {
  emoji: steps.draft_3p.emoji
  progress: steps.draft_3p.progress
  plans: steps.draft_3p.plans
  problems: steps.draft_3p.problems
  formatted: steps.draft_3p.formatted
}
```
