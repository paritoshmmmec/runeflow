---
name: 3p-updates
description: 3P Updates
version: 0.1
inputs: {}
outputs:
  result: string
---

```runeflow
step slack type=tool {
  tool: replace.me  # TODO: wire to actual tool — original: Slack
  with: {}
  out: { result: string }
}
step email type=tool {
  tool: replace.me  # TODO: wire to actual tool — original: Email
  with: {}
  out: { result: string }
}
step calendar type=tool {
  tool: replace.me  # TODO: wire to actual tool — original: Calendar
  with: {}
  out: { result: string }
}
step progress type=tool {
  tool: replace.me  # TODO: wire to actual tool — original: Progress
  with: {}
  out: { result: string }
}
step plans type=tool {
  tool: replace.me  # TODO: wire to actual tool — original: Plans
  with: {}
  out: { result: string }
}
step problems type=tool {
  tool: replace.me  # TODO: wire to actual tool — original: Problems
  with: {}
  out: { result: string }
}
output {
  result: steps.problems.result
}
```
