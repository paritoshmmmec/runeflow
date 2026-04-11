---
name: addresszen-automation-via-rube-mcp
description: Addresszen Automation via Rube MCP
version: 0.1
inputs: {}
outputs:
  result: string
llm:
  provider: placeholder
  model: placeholder
---

```runeflow
step run type=llm {
  prompt: "Complete the task described above."
  schema: {"result":"string"}
}
output {
  result: steps.run.result
}
```
