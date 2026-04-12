---
name: checkpoint
description: |
  Save and resume working state. Captures git state, decisions made, and
  remaining work so any future session can pick up exactly where it left off.
  Pass mode=save (default) or mode=resume.
version: 0.1
inputs:
  mode: string
  title: string
outputs:
  checkpoint_path: string
  summary: string
llm:
  provider: cerebras
  model: qwen-3-235b-a22b-instruct-2507
---

# Checkpoint

Capture the full working context — what's being done, what decisions were made,
what's left. Be concrete. Name files, functions, and line numbers. Write for a
future session that has no memory of this one.

```runeflow
branch route {
  if: inputs.mode matches "^resume$"
  then: read_latest
  else: gather_state
}
```

## Save — gather git state

Collect everything needed to reconstruct context: branch, uncommitted changes,
recent commits.

```runeflow
step gather_state type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step diff_stat type=tool {
  tool: git.diff_summary
  with: { base: "HEAD" }
  out: { base: string, summary: string, files: [string] }
}

step recent_log type=tool {
  tool: git.log
  with: { base: "HEAD~10" }
  out: { commits: [string] }
}

step ask_title type=human_input skip_if="inputs.title" {
  prompt: "Short checkpoint title (3-6 words describing what you're working on):"
  default: "work-in-progress"
}

step summarize type=llm {
  prompt: |
    Write a checkpoint summary for a future session to resume this work.

    Branch: {{ steps.gather_state.branch }}
    Recent commits: {{ steps.recent_log.commits }}
    Modified files: {{ steps.diff_stat.files }}
    Diff: {{ steps.diff_stat.summary }}
    Title: {{ inputs.title or steps.ask_title.answer }}

    Cover:
    1. What is being worked on (high-level goal)
    2. Decisions made and why
    3. Remaining work (numbered, priority order)
    4. Gotchas, blocked items, open questions
  input: {
    branch: steps.gather_state.branch,
    commits: steps.recent_log.commits,
    files: steps.diff_stat.files,
    diff: steps.diff_stat.summary
  }
  schema: {
    title: string,
    summary: string,
    decisions: [string],
    remaining_work: [string],
    notes: string
  }
}

step build_content type=transform {
  input: steps.summarize
  expr: |
    `---\nbranch: ${input.title}\nstatus: in-progress\n---\n\n## ${input.title}\n\n${input.summary}\n\n### Decisions Made\n\n${input.decisions.map((d) => `- ${d}`).join('\n')}\n\n### Remaining Work\n\n${input.remaining_work.map((r,i) => `${i+1}. ${r}`).join('\n')}\n\n### Notes\n\n${input.notes}\n`
  out: { content: string }
}

step write_checkpoint type=tool {
  tool: file.write
  with: {
    path: ".runeflow/checkpoints/checkpoint.md",
    content: steps.build_content.content
  }
  out: { written: boolean }
}

output {
  checkpoint_path: ".runeflow/checkpoints/checkpoint.md"
  summary: steps.summarize.summary
}
```

## Resume — load latest checkpoint

Read the most recent checkpoint and present it so the session can continue.

```runeflow
step read_latest type=tool {
  tool: file.read
  with: { path: ".runeflow/checkpoints" }
  out: { content: string }
}

step parse_checkpoint type=llm {
  prompt: |
    Extract the key context from this checkpoint file so a new session can resume.
    Checkpoint content: {{ steps.read_latest.content }}

    Return the title, summary, and the first remaining work item to tackle next.
  input: { content: steps.read_latest.content }
  schema: {
    title: string,
    summary: string,
    next_step: string,
    branch: string
  }
}

step confirm_resume type=human_input {
  prompt: "Resume '{{ steps.parse_checkpoint.title }}'? Next: {{ steps.parse_checkpoint.next_step }}"
  required: true
  choices: ["yes", "no"]
  default: "yes"
}

output {
  checkpoint_path: steps.read_latest.content
  summary: steps.parse_checkpoint.summary
}
```
