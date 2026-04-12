// Mock runtime for weekly-repo-digest.
// Replace github.* and slack.* with real clients for live runs.
export default {
  tools: {
    "github.count_open_prs": async ({ repo }) => {
      if (process.env.GITHUB_TOKEN) {
        const { Octokit } = await import("@octokit/rest");
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const [owner, repoName] = repo.split("/");
        const { data } = await octokit.pulls.list({ owner, repo: repoName, state: "open", per_page: 1 });
        // Use link header for total count if available, else return page length
        return { count: data.length };
      }
      console.error(`[dry-run] github.count_open_prs → ${repo}`);
      return { count: 0 };
    },
    "github.list_stale_prs": async ({ repo, stale_days }) => {
      if (process.env.GITHUB_TOKEN) {
        const { Octokit } = await import("@octokit/rest");
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const [owner, repoName] = repo.split("/");
        const { data } = await octokit.pulls.list({ owner, repo: repoName, state: "open", per_page: 50 });
        const cutoff = Date.now() - stale_days * 86_400_000;
        const prs = data
          .filter((pr) => new Date(pr.created_at).getTime() < cutoff)
          .map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user.login,
            days_open: Math.floor((Date.now() - new Date(pr.created_at).getTime()) / 86_400_000),
          }));
        return { prs };
      }
      console.error(`[dry-run] github.list_stale_prs → ${repo}`);
      return { prs: [] };
    },
    "slack.post_message": async ({ channel, text }) => {
      if (process.env.SLACK_BOT_TOKEN) {
        const { WebClient } = await import("@slack/web-api");
        const client = new WebClient(process.env.SLACK_BOT_TOKEN);
        const result = await client.chat.postMessage({ channel, text });
        return { ok: result.ok, ts: result.ts };
      }
      console.error(`[dry-run] slack.post_message → ${channel}`);
      return { ok: true, ts: Date.now().toString() };
    },
  },
};
