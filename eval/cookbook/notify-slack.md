---
name: notify-slack-on-deploy
description: Run a deploy command, then post a success or failure message to Slack.
version: 0.1
inputs:
  deploy_command: string
  slack_channel: string
  environment: string
outputs:
  status: string
  exit_code: number
llm:
  provider: cerebras
  router: false
  model: qwen-3-235b-a22b-instruct-2507
---

# Notify Slack on Deploy

Run a deploy command and post the outcome to a Slack channel. The LLM drafts a
human-friendly message — keep it short, factual, and include the environment name.
If the deploy failed, lead with the failure and include the first line of stderr.

```runeflow
step deploy type=cli cache=false allow_failure=true {
  command: "sh -c '{{ inputs.deploy_command }}'"
}

branch check_result {
  if: steps.deploy.exit_code == 0
  then: draft_success
  else: draft_failure
}

step draft_success type=llm {
  prompt: |
    The deploy to {{ inputs.environment }} succeeded.
    Write a short Slack message (1-2 sentences) announcing the successful deploy.
  input: {
    environment: inputs.environment,
    stdout: steps.deploy.stdout
  }
  schema: { message: string }
}

step post_success type=tool {
  tool: slack.post_message
  with: {
    channel: inputs.slack_channel,
    text: steps.draft_success.message
  }
  out: { ok: boolean, ts: string }
}

step draft_failure type=llm {
  prompt: |
    The deploy to {{ inputs.environment }} failed with exit code {{ steps.deploy.exit_code }}.
    stderr: {{ steps.deploy.stderr }}
    Write a short Slack message (1-2 sentences) alerting the team to the failure.
  input: {
    environment: inputs.environment,
    exit_code: steps.deploy.exit_code,
    stderr: steps.deploy.stderr
  }
  schema: { message: string }
}

step post_failure type=tool {
  tool: slack.post_message
  with: {
    channel: inputs.slack_channel,
    text: steps.draft_failure.message
  }
  out: { ok: boolean, ts: string }
}

output {
  status: steps.deploy.exit_code == 0 ? "success" : "failure"
  exit_code: steps.deploy.exit_code
}
```
