// Runtime for pr-notify-notion.
// Set GITHUB_TOKEN, SLACK_BOT_TOKEN, and NOTION_TOKEN for live runs.
export default {
  tools: {
    "git.current_branch": async () => {
      const { execSync } = await import("node:child_process");
      const branch = execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
      return { branch };
    },

    "git.diff_summary": async ({ base }) => {
      const { execSync } = await import("node:child_process");
      const summary = execSync(`git diff ${base}...HEAD --stat`).toString().trim();
      const filesRaw = execSync(`git diff ${base}...HEAD --name-only`).toString().trim();
      const files = filesRaw ? filesRaw.split("\n") : [];
      return { base, summary, files };
    },

    "github.create_pr": async ({ owner, repo, title, body, head, base, draft }) => {
      if (process.env.GITHUB_TOKEN) {
        const { Octokit } = await import("@octokit/rest");
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const { data } = await octokit.pulls.create({ owner, repo, title, body, head, base, draft });
        return { number: data.number, url: data.html_url, state: data.state };
      }
      console.error(`[dry-run] github.create_pr → ${owner}/${repo}: ${title}`);
      return { number: 0, url: "https://github.com/dry-run", state: "open" };
    },

    "slack.post_message": async ({ channel, text }) => {
      if (process.env.SLACK_BOT_TOKEN) {
        const { WebClient } = await import("@slack/web-api");
        const client = new WebClient(process.env.SLACK_BOT_TOKEN);
        const result = await client.chat.postMessage({ channel, text });
        return { ok: result.ok, ts: result.ts };
      }
      console.error(`[dry-run] slack.post_message → ${channel}: ${text}`);
      return { ok: true, ts: Date.now().toString() };
    },

    "notion.create_page": async ({ parent_id, parent_type, title, content }) => {
      if (process.env.NOTION_TOKEN) {
        const { Client } = await import("@notionhq/client");
        const client = new Client({ auth: process.env.NOTION_TOKEN });
        const parent = parent_type === "database"
          ? { database_id: parent_id }
          : { page_id: parent_id };
        const page = await client.pages.create({
          parent,
          properties: { title: { title: [{ type: "text", text: { content: title } }] } },
          children: content ? [{
            object: "block", type: "paragraph",
            paragraph: { rich_text: [{ type: "text", text: { content } }] },
          }] : [],
        });
        return { id: page.id, url: page.url };
      }
      console.error(`[dry-run] notion.create_page → ${parent_id}: ${title}`);
      return { id: "dry-run-page-id", url: "https://notion.so/dry-run" };
    },
  },
};
