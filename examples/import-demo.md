---
name: import-demo
description: Demonstrates cross-file block imports from shared-blocks.md.
version: 0.1
inputs:
  base_branch: string
  path: string
outputs:
  branch: string
  exists: boolean
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Import Demo

Shows how to import reusable blocks from another `.md` file.
The `check_file_exists` block comes from `shared-blocks.md`.

```runeflow
import blocks from "./shared-blocks.md"

step branch type=tool {
  tool: git.current_branch
  out: { branch: string }
}

step check type=block {
  block: check_file_exists
}

output {
  branch: steps.branch.branch
  exists: steps.check.exists
}
```
