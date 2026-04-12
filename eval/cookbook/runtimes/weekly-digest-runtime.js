// Mock runtime for weekly-repo-digest.
// Replace github.* and slack.* with real clients for live runs.
export default {
  tools: {
    "github.count_open_prs": async ({ owner, repo }) => {
      if (process.env.GITHUB_TOKEN) {
        const { Octokit } = await import("@octokit/rest");
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        // Fetch up to 100 per page and follow the link header for the real total
        const response = await octokit.pulls.list({ owner, repo, state: "open", per_page: 100 });
        const linkHeader = response.headers?.link ?? "";
        // If there's a "last" page link, parse its page number for the true count
        const lastPageMatch = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
        if (lastPageMatch) {
          // last_page * 100 overcounts slightly but is the best we can do without
          // the search API. Use the actual data length for single-page results.
          const lastPage = parseInt(lastPageMatch[1], 10);
          const count = (lastPage - 1) * 100 + response.data.length;
          return { count };
        }
        return { count: response.data.length };
      }
      console.error(`[dry-run] github.count_open_prs → ${owner}/${repo}`);
      return { count: 0 };
    },
    "github.list_stale_prs": async ({ owner, repo, days_since_update }) => {
      if (process.env.GITHUB_TOKEN) {
        const { Octokit } = await import("@octokit/rest");
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const { data } = await octokit.pulls.list({ owner, repo, state: "open", per_page: 100 });
        const cutoff = Date.now() - days_since_update * 86_400_000;
        const pull_requests = data
          .filter((pr) => new Date(pr.updated_at).getTime() < cutoff)
          .map((pr) => ({
            number: pr.number,
            title: pr.title,
            url: pr.html_url,
            author: pr.user.login,
            updated_at: pr.updated_at,
            days_since_update: Math.floor((Date.now() - new Date(pr.updated_at).getTime()) / 86_400_000),
          }));
        return { pull_requests };
      }
      console.error(`[dry-run] github.list_stale_prs → ${owner}/${repo}`);
      return { pull_requests: [] };
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
