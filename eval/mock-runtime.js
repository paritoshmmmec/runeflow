function buildTitle(branch) {
  return `Prepare PR for ${branch}`;
}

function buildBody(input) {
  const files = Array.isArray(input.changed_files) ? input.changed_files.join(", ") : "none";

  return [
    `Base branch: ${input.base_branch}`,
    `Template present: ${input.template_exists}`,
    `Changed files: ${files}`,
    "",
    "Diff summary:",
    input.diff_summary,
  ].join("\n");
}

async function handleDraft({ input }) {
  return {
    title: buildTitle(input.branch),
    body: buildBody(input),
  };
}

export const llms = {
  cerebras: handleDraft,
  anthropic: handleDraft,
};
