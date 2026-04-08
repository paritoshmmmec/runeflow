import { createComposioClientPlugin, createDefaultRuntime } from "../src/index.js";

const plugin = await createComposioClientPlugin({
  tools: ["GITHUB_LIST_BRANCHES"],
  toolkitVersions: process.env.COMPOSIO_TOOLKIT_VERSION_GITHUB
    ? { github: process.env.COMPOSIO_TOOLKIT_VERSION_GITHUB }
    : undefined,
  executeDefaults: {
    connectedAccountId: process.env.COMPOSIO_GITHUB_CONNECTED_ACCOUNT_ID,
    userId: process.env.COMPOSIO_GITHUB_USER_ID ?? process.env.COMPOSIO_ENTITY_ID,
  },
});

export default {
  ...createDefaultRuntime(),
  plugins: [plugin],
};
