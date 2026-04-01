export const tools = {
  "file.exists": async ({ path }) => ({
    exists: path === ".github/pull_request_template.md",
  }),
  "git.push_current_branch": async () => ({
    branch: "codex/example-open-pr",
    remote: "origin",
  }),
  "github.create_pr": async ({ title, body, base, draft }) => ({
    pr_number: 42,
    pr_url: `https://example.test/${encodeURIComponent(base)}/${draft ? "draft" : "ready"}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`,
  }),
  "util.fail": async ({ message }) => ({
    message,
  }),
  "util.complete": async ({ pr_url }) => ({
    pr_url,
  }),
};

export async function llm({ input }) {
  if (input.template_exists) {
    return {
      title: "Use existing PR template",
      body: "Filled from template-aware draft flow.",
    };
  }

  return {
    title: "Create pull request",
    body: "Generated without a template.",
  };
}
