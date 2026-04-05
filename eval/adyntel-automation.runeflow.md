---
name: adyntel-automation
description: Runeflow baseline for Adyntel automation.
version: 0.1
inputs:
  task_query: string
outputs:
  status: string
  action_taken: string
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Adyntel Automation

Instead of forcing the LLM to search for tools dynamically, the runtime handles connection verification and passes the explicit MCP operation payloads.

```runeflow
step check_connection type=tool {
  tool: rube.manage_connections
  with: { toolkits: ["adyntel"] }
  out: { status: string, auth_link: string }
  next: check_auth
}

branch check_auth {
  if: steps.check_connection.status != "ACTIVE"
  then: fail_unauth
  else: adyntel_task
}

step fail_unauth type=tool {
  tool: util.fail
  with: { message: "Authentication required. Please visit {{ steps.check_connection.auth_link }}" }
  out: { message: string }
}

step adyntel_task type=llm {
  prompt: "Determine the required operation for: {{ inputs.task_query }}"
  input: { task_query: inputs.task_query }
  schema: { status: string, action_taken: string }
}

output {
  status: steps.adyntel_task.status
  action_taken: steps.adyntel_task.action_taken
}
```
