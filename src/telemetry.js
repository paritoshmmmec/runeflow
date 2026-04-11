/**
 * runeflow telemetry
 *
 * Zero-dependency OpenTelemetry span emission.
 * When --telemetry is passed to `runeflow run`, one span is emitted per step
 * in OTLP JSON format (https://opentelemetry.io/docs/specs/otlp/).
 *
 * Output goes to stderr by default so it doesn't pollute the run JSON on stdout.
 * Redirect with --telemetry-output <path> to write to a file instead.
 *
 * Plugs into any OTel collector via file tail or pipe:
 *   runeflow run ./workflow.runeflow.md --telemetry 2>spans.jsonl
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function toNanoseconds(isoString) {
  return BigInt(Date.parse(isoString)) * 1_000_000n;
}

function buildSpan({ traceId, runId, step, stepRun }) {
  const startNs = stepRun.started_at ? toNanoseconds(stepRun.started_at) : 0n;
  const endNs = stepRun.finished_at ? toNanoseconds(stepRun.finished_at) : startNs;

  const attributes = [
    { key: "runeflow.run_id",    value: { stringValue: runId } },
    { key: "runeflow.step.kind", value: { stringValue: step.kind } },
    { key: "runeflow.step.status", value: { stringValue: stepRun.status } },
    { key: "runeflow.step.attempts", value: { intValue: stepRun.attempts ?? 1 } },
  ];

  if (step.tool) {
    attributes.push({ key: "runeflow.step.tool", value: { stringValue: step.tool } });
  }

  if (stepRun.token_usage) {
    const { prompt_tokens, completion_tokens } = stepRun.token_usage;
    if (prompt_tokens != null) {
      attributes.push({ key: "llm.usage.prompt_tokens", value: { intValue: prompt_tokens } });
    }
    if (completion_tokens != null) {
      attributes.push({ key: "llm.usage.completion_tokens", value: { intValue: completion_tokens } });
    }
  }

  if (stepRun.error) {
    attributes.push({ key: "error.message", value: { stringValue: stepRun.error.message } });
  }

  return {
    traceId,
    spanId: randomHex(8),
    name: `runeflow.step.${step.id}`,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: startNs.toString(),
    endTimeUnixNano: endNs.toString(),
    attributes,
    status: {
      code: stepRun.status === "success" ? 1 : 2, // OK=1, ERROR=2
    },
  };
}

/**
 * Create a telemetry emitter for a run.
 *
 * @param {object} options
 * @param {string} [options.output] - file path to write spans to (default: stderr)
 * @returns {{ emitStep: Function, flush: Function }}
 */
export function createTelemetryEmitter(options = {}) {
  const traceId = randomHex(16);
  const lines = [];

  return {
    traceId,

    emitStep({ runId, step, stepRun }) {
      const span = buildSpan({ traceId, runId, step, stepRun });
      // OTLP JSON Lines format — one ResourceSpans envelope per span
      const envelope = {
        resourceSpans: [{
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "runeflow" } },
            ],
          },
          scopeSpans: [{
            scope: { name: "runeflow", version: "0.1" },
            spans: [span],
          }],
        }],
      };
      lines.push(JSON.stringify(envelope));
    },

    async flush() {
      if (lines.length === 0) return;
      const output = lines.join("\n") + "\n";
      if (options.output) {
        await fs.appendFile(options.output, output);
      } else {
        process.stderr.write(output);
      }
    },
  };
}
