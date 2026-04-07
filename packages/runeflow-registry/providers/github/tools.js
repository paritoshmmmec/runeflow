/**
 * GitHub tool implementations using @octokit/rest.
 * Install: npm install @octokit/rest
 */

async function loadOctokit(token) {
  try {
    const { Octokit } = await import("@octokit/rest");
    return new Octokit({ auth: token });
  } catch {
    throw new Error(
      "GitHub provider requires @octokit/rest.\n  Fix: npm install @octokit/rest",
    );
  }
}

/**
 * @param {{ token: string }} config
 * @returns {Record<string, Function>}
 */
export function github({ token } = {}) {
  if (!token) {
    throw new Error("github() requires a token. Pass { token: process.env.GITHUB_TOKEN }");
  }

  return {
    "github.get_pr": async ({ owner, repo, number }) => {
      const octokit = await loadOctokit(token);
      const { data } = await octokit.pulls.get({ owner, repo, pull_number: number });
      return {
        number: data.number,
        title: data.title,
        body: data.body ?? "",
        state: data.state,
        url: data.html_url,
        author: data.user.login,
        base: data.base.ref,
        head: data.head.ref,
        merged: data.merged ?? false,
        draft: data.draft ?? false,
      };
    },

    "github.create_pr": async ({ owner, repo, title, body, head, base, draft }) => {
      const octokit = await loadOctokit(token);
      const { data } = await octokit.pulls.create({ owner, repo, title, body, head, base, draft });
      return { number: data.number, url: data.html_url, state: data.state };
    },

    "github.merge_pr": async ({ owner, repo, number, merge_method, commit_message }) => {
      const octokit = await loadOctokit(token);
      const { data } = await octokit.pulls.merge({
        owner, repo, pull_number: number,
        merge_method: merge_method ?? "merge",
        commit_message,
      });
      return { merged: data.merged, message: data.message, sha: data.sha ?? "" };
    },

    "github.add_label": async ({ owner, repo, number, labels }) => {
      const octokit = await loadOctokit(token);
      const { data } = await octokit.issues.addLabels({ owner, repo, issue_number: number, labels });
      return { labels: data.map((l) => l.name) };
    },

    "github.create_issue": async ({ owner, repo, title, body, labels, assignees }) => {
      const octokit = await loadOctokit(token);
      const { data } = await octokit.issues.create({ owner, repo, title, body, labels, assignees });
      return { number: data.number, url: data.html_url, state: data.state };
    },
  };
}
