export const schemas = [
  {
    name: "slack.post_message",
    description: "Post a message to a Slack channel.",
    tags: ["slack", "messaging"],
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID or name, e.g. #general." },
        text:    { type: "string" },
        blocks:  { type: "array", items: { type: "object" }, description: "Optional Block Kit blocks." },
      },
      required: ["channel", "text"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ts:      { type: "string", description: "Message timestamp (unique ID)." },
        channel: { type: "string" },
      },
      required: ["ts", "channel"],
      additionalProperties: false,
    },
  },
  {
    name: "slack.get_channel_history",
    description: "Fetch recent messages from a Slack channel.",
    tags: ["slack", "messaging"],
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string" },
        limit:   { type: "number", description: "Max messages to return. Defaults to 20." },
      },
      required: ["channel"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ts:   { type: "string" },
              user: { type: "string" },
              text: { type: "string" },
            },
            required: ["ts", "text"],
            additionalProperties: false,
          },
        },
      },
      required: ["messages"],
      additionalProperties: false,
    },
  },
];
