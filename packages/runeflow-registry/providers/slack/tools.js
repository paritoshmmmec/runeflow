/**
 * Slack tool implementations using @slack/web-api.
 * Install: npm install @slack/web-api
 */

async function loadSlack(token) {
  try {
    const { WebClient } = await import("@slack/web-api");
    return new WebClient(token);
  } catch {
    throw new Error("Slack provider requires @slack/web-api.\n  Fix: npm install @slack/web-api");
  }
}

export function slack({ token } = {}) {
  if (!token) {
    throw new Error("slack() requires a token. Pass { token: process.env.SLACK_BOT_TOKEN }");
  }

  return {
    "slack.post_message": async ({ channel, text, blocks }) => {
      const client = await loadSlack(token);
      const result = await client.chat.postMessage({ channel, text, blocks });
      return { ts: result.ts, channel: result.channel };
    },

    "slack.get_channel_history": async ({ channel, limit = 20 }) => {
      const client = await loadSlack(token);
      const result = await client.conversations.history({ channel, limit });
      return {
        messages: (result.messages ?? []).map((m) => ({
          ts: m.ts,
          user: m.user ?? "",
          text: m.text ?? "",
        })),
      };
    },
  };
}
