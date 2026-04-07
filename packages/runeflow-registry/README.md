# runeflow-registry

Official tool registry for [Runeflow](https://github.com/paritoshmmmec/runeflow). Schema + implementation travel together — install only the providers you need.

## Install

```bash
npm install runeflow-registry

# then install the provider packages you need
npm install @octokit/rest       # github
npm install @linear/sdk         # linear
npm install @slack/web-api      # slack
npm install @notionhq/client    # notion
```

## Usage

```js
// runtime.js
import { createDefaultRuntime } from "runeflow";
import { github, linear, slack } from "runeflow-registry";

export default {
  ...createDefaultRuntime(),
  tools: {
    ...github({ token: process.env.GITHUB_TOKEN }),
    ...linear({ apiKey: process.env.LINEAR_API_KEY }),
    ...slack({ token: process.env.SLACK_BOT_TOKEN }),
  },
};
```

Then in your skill:

```runeflow
step create_pr type=tool {
  tool: github.create_pr
  with: {
    owner: "my-org",
    repo: "my-repo",
    title: steps.draft.title,
    body: steps.draft.body,
    head: steps.branch.branch,
    base: inputs.base_branch
  }
}
```

## Providers

| Provider | Package | Tools |
|---|---|---|
| `github` | `@octokit/rest` | `get_pr`, `create_pr`, `merge_pr`, `add_label`, `create_issue` |
| `linear` | `@linear/sdk` | `create_issue`, `update_issue` |
| `slack` | `@slack/web-api` | `post_message`, `get_channel_history` |
| `notion` | `@notionhq/client` | `create_page`, `query_database` |

## Discover tools

```bash
runeflow tools list
runeflow tools inspect github.create_pr
```

## License

MIT
