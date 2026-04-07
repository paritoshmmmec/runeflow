/**
 * Linear tool implementations using @linear/sdk.
 * Install: npm install @linear/sdk
 */

async function loadLinear(apiKey) {
  try {
    const { LinearClient } = await import("@linear/sdk");
    return new LinearClient({ apiKey });
  } catch {
    throw new Error("Linear provider requires @linear/sdk.\n  Fix: npm install @linear/sdk");
  }
}

export function linear({ apiKey } = {}) {
  if (!apiKey) {
    throw new Error("linear() requires an apiKey. Pass { apiKey: process.env.LINEAR_API_KEY }");
  }

  return {
    "linear.create_issue": async ({ team_key, title, description, priority, assignee_email }) => {
      const client = await loadLinear(apiKey);
      const teams = await client.teams({ filter: { key: { eq: team_key } } });
      const team = teams.nodes[0];
      if (!team) throw new Error(`Linear team '${team_key}' not found.`);

      let assigneeId;
      if (assignee_email) {
        const users = await client.users({ filter: { email: { eq: assignee_email } } });
        assigneeId = users.nodes[0]?.id;
      }

      const issue = await client.createIssue({
        teamId: team.id,
        title,
        description,
        priority,
        assigneeId,
      });

      const created = await issue.issue;
      return { id: created.id, identifier: created.identifier, url: created.url };
    },

    "linear.update_issue": async ({ issue_id, state, priority, assignee_email, title }) => {
      const client = await loadLinear(apiKey);

      let stateId;
      if (state) {
        const issue = await client.issue(issue_id);
        const team = await issue.team;
        const states = await team.states({ filter: { name: { eq: state } } });
        stateId = states.nodes[0]?.id;
      }

      let assigneeId;
      if (assignee_email) {
        const users = await client.users({ filter: { email: { eq: assignee_email } } });
        assigneeId = users.nodes[0]?.id;
      }

      await client.updateIssue(issue_id, { title, priority, stateId, assigneeId });
      return { id: issue_id, updated: true };
    },
  };
}
