// Mock runtime for notify-slack-on-deploy.
// Replace slack.post_message with a real Slack client for live runs.
export default {
  tools: {
    "slack.post_message": async ({ channel, text }) => {
      if (process.env.SLACK_BOT_TOKEN) {
        const { WebClient } = await import("@slack/web-api");
        const client = new WebClient(process.env.SLACK_BOT_TOKEN);
        const result = await client.chat.postMessage({ channel, text });
        return { ok: result.ok, ts: result.ts };
      }
      // Dry-run: just log
      console.error(`[dry-run] slack.post_message → ${channel}: ${text}`);
      return { ok: true, ts: Date.now().toString() };
    },
  },
};
