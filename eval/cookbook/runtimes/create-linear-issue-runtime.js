// Mock runtime for create-linear-issue-from-failure.
// Replace linear.create_issue with a real Linear client for live runs.
export default {
  tools: {
    "linear.create_issue": async ({ team_id, title, description }) => {
      if (process.env.LINEAR_API_KEY) {
        const { LinearClient } = await import("@linear/sdk");
        const client = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
        const issue = await client.createIssue({ teamId: team_id, title, description });
        const data = await issue.issue;
        return { id: data.identifier, url: data.url };
      }
      console.error(`[dry-run] linear.create_issue → ${team_id}: ${title}`);
      return { id: "DRY-0", url: "https://linear.app/dry-run" };
    },
  },
};
