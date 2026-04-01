import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parseRuneflow } from "../src/parser.js";
import { runRuneflow } from "../src/runtime.js";

test("runRuneflow executes linear tool -> llm -> tool workflow and writes artifacts", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: linear
description: Linear workflow
version: 0.1
inputs:
  draft: boolean
outputs:
  pr_url: string
---

\`\`\`runeflow
step first type=tool {
  tool: mock.first
  out: { ready: boolean }
}

step draft type=llm {
  prompt: "write"
  input: { ready: steps.first.ready }
  schema: { title: string, body: string }
}

step publish type=tool {
  tool: mock.publish
  with: {
    title: steps.draft.title,
    draft: inputs.draft,
    draft_result_path: steps.draft.result_path
  }
  out: { pr_url: string }
}

output {
  pr_url: steps.publish.pr_url
}
\`\`\`
`);

  const runtime = {
    tools: {
      "mock.first": async () => ({ ready: true }),
      "mock.publish": async ({ title, draft, draft_result_path }) => {
        const draftArtifact = JSON.parse(await fs.readFile(draft_result_path, "utf8"));
        assert.equal(draftArtifact.outputs.title, title);
        return {
          pr_url: `https://example.test/${draft ? "draft" : "ready"}/${encodeURIComponent(title)}`,
        };
      },
    },
    llm: async () => ({
      title: "Demo PR",
      body: "Body",
    }),
  };

  const run = await runRuneflow(parsed, { draft: true }, runtime, { runsDir });

  assert.equal(run.status, "success");
  assert.equal(run.steps.length, 3);
  assert.equal(run.outputs.pr_url, "https://example.test/draft/Demo%20PR");
  assert.match(run.steps[1].result_path, /draft\.json$/);

  const artifact = JSON.parse(await fs.readFile(run.artifact_path, "utf8"));
  assert.equal(artifact.run_id, run.run_id);
  assert.equal(artifact.runeflow.name, "linear");
  assert.equal(artifact.steps[1].outputs.title, "Demo PR");
});

test("runRuneflow retries llm validation failure and uses fallback", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  let attempts = 0;
  const parsed = parseRuneflow(`---
name: fallback
description: Fallback workflow
version: 0.1
inputs: {}
outputs:
  result: string
---

\`\`\`runeflow
step draft type=llm retry=1 fallback=recover {
  prompt: "write"
  schema: { title: string }
}

step publish type=tool {
  tool: mock.publish
  with: { title: steps.draft.title }
  out: { result: string }
}

step recover type=tool {
  tool: mock.recover
  out: { result: string }
}

output {
  result: steps.recover.result
}
\`\`\`
`);

  const runtime = {
    tools: {
      "mock.publish": async ({ title }) => ({ result: title }),
      "mock.recover": async () => ({ result: "recovered" }),
    },
    llm: async () => {
      attempts += 1;
      return attempts === 1 ? { title: 42 } : { title: 42 };
    },
  };

  const run = await runRuneflow(parsed, {}, runtime, { runsDir });

  assert.equal(run.status, "success");
  assert.equal(run.steps[0].status, "failed");
  assert.equal(run.steps[0].attempts, 2);
  assert.equal(run.steps[1].id, "recover");
  assert.equal(run.outputs.result, "recovered");
});

test("runRuneflow routes branch targets", async () => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "runeflow-runs-"));
  const parsed = parseRuneflow(`---
name: branch
description: Branch workflow
version: 0.1
inputs:
  use_primary: boolean
outputs:
  result: string
---

\`\`\`runeflow
branch choose {
  if: inputs.use_primary
  then: primary
  else: secondary
}

step primary type=tool {
  tool: mock.primary
  out: { result: string }
  next: finish
}

step secondary type=tool {
  tool: mock.secondary
  out: { result: string }
}

step finish type=tool {
  tool: mock.finish
  with: { chosen: steps.primary.result }
  out: { result: string }
}

output {
  result: steps.finish.result
}
\`\`\`
`);

  const runtime = {
    tools: {
      "mock.primary": async () => ({ result: "primary" }),
      "mock.secondary": async () => ({ result: "secondary" }),
      "mock.finish": async ({ chosen }) => ({ result: `${chosen}-done` }),
    },
  };

  const run = await runRuneflow(parsed, { use_primary: true }, runtime, { runsDir });

  assert.equal(run.status, "success");
  assert.deepEqual(run.steps.map((step) => step.id), ["choose", "primary", "finish"]);
  assert.equal(run.outputs.result, "primary-done");
});
