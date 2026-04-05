---
name: 3p-updates-raw
description: Raw baseline for writing a 3P update from workplace context.
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

You are being asked to write a 3P update. 3P updates stand for "Progress, Plans, Problems." The main audience is executives, leadership, and teammates with some, but not a lot, of context. They should be very succinct and readable in 30-60 seconds.

3Ps can cover a team of any size. The bigger the team, the less granular the tasks should be.

They represent the work of the team across a time period, almost always one week. They include three sections:

1. Progress: what the team accomplished over the covered period.
2. Plans: what the team plans to do next.
3. Problems: anything slowing the team down.

## Tools Available

Whenever possible, try to pull from available sources:

- Slack: updates from team members
- Google Drive: docs with strong engagement
- Email: relevant active threads
- Calendar: important non-recurring meetings

Gather as much context as you can for the requested time period:

- Progress: about a week ago through today
- Plans: today through the next week
- Problems: about a week ago through today

If a source is unavailable, continue with what you have.

## Workflow

1. Clarify scope: confirm the team name and the time period.
2. Gather information from the available sources.
3. Draft the update.
4. Review for concision and formatting.

## Formatting

The formatting is strict. Pick an emoji that matches the vibe of the team and update.

```text
[emoji] [Team Name] ([Dates Covered])
Progress: [1-3 sentences]
Plans: [1-3 sentences]
Problems: [1-3 sentences]
```

Each section should be concise, data-driven, and matter-of-fact.

Return valid JSON with:

- `emoji`
- `progress`
- `plans`
- `problems`
- `formatted`
