import { template as openPr } from "./open-pr.js";
import { template as releaseNotes } from "./release-notes.js";
import { template as testAndLint } from "./test-and-lint.js";
import { template as deploy } from "./deploy.js";
import { template as notifySlack } from "./notify-slack.js";
import { template as stripePayment } from "./stripe-payment.js";
import { template as linearIssue } from "./linear-issue.js";
import { template as genericLlmTask } from "./generic-llm-task.js";

export const templates = [
  openPr,
  releaseNotes,
  testAndLint,
  deploy,
  notifySlack,
  stripePayment,
  linearIssue,
  genericLlmTask,
];

export function getTemplate(id) {
  return templates.find((t) => t.id === id) ?? null;
}
