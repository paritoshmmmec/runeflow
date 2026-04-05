# Benchmark Report: Runeflow vs. Raw Skills

This report compiles the performance and token efficiency metrics for the `3p-updates` and `open-pr` tasks, comparing **Cerebras** (Qwen-235B) and **OpenAI** (GPT-4o) as providers.

## Executive Summary

Runeflow consistently demonstrates significant **token efficiency gains** over the raw skill baselines. In complex tasks like `3p-updates`, Runeflow reduced input tokens by **~35-38%**, while in simple tasks like `open-pr`, the overhead was minimal.

---

## 1. Task: `3p-updates`
*Complex synthesis task with multi-source context.*

### Performance & Usage Table

| Metric | Cerebras (Raw) | Cerebras (Runeflow) | OpenAI (Raw) | OpenAI (Runeflow) |
| :--- | :--- | :--- | :--- | :--- |
| **Model** | `qwen-3-235b...` | `qwen-3-235b...` | `gpt-4o` | `gpt-4o` |
| **Status** | ✅ Success | ✅ Success | ✅ Success | ✅ Success |
| **Latency (Total)** | 1,548ms | 1,348ms | 2,771ms | 2,548ms |
| **Input Tokens** | 825 | 508 (**-38%**) | 814 | 497 (**-39%**) |
| **Output Tokens**| 289 | 296 | 259 | 195 |
| **Total Tokens** | 1,114 | **804** | 1,073 | **692** |

### Key Observations
- **Token Efficiency**: Runeflow's structured approach significantly reduces the input token count for synthesis tasks by filtering or structuring context more effectively than a flat prompt.
- **Provider Speed**: Cerebras consistently outperforms OpenAI in latency for this specific task.

---

## 2. Task: `open-pr`
*Simple templating task using mock runtime logic.*

### Performance & Usage Table

| Metric | Cerebras (Raw) | Cerebras (Runeflow) | OpenAI (Raw) | OpenAI (Runeflow) |
| :--- | :--- | :--- | :--- | :--- |
| **Model** | `qwen-3-235b...` | `qwen-3-235b...` | `gpt-4o` | `gpt-4o` |
| **Status** | ✅ Success | ✅ Success | ✅ Success | ✅ Success |
| **Latency (Total)** | 72ms | 19ms | 66ms | 22ms |
| **Input Tokens** | 219 | 236 (+7%) | 208 | 225 (+8%) |
| **Output Tokens**| 34 | 34 | 34 | 34 |
| **Total Tokens** | 253 | 270 | 242 | 259 |

### Key Observations
- **Orchestration Overhead**: For simple tasks where the input is small, Runeflow introduces a negligible increase in input tokens (due to workflow metadata/structure) but executes faster due to local mock logic compared to the raw harness overhead.
- **Minimal Impact**: The differences here are within the noise margin for simple templating.

---


## 3. Task: `adyntel-automation`
*Orchestration-heavy task mimicking MCP dynamic tool execution.*

### Performance & Usage Table

| Metric | Cerebras (Raw) | Cerebras (Runeflow) | OpenAI (Raw) | OpenAI (Runeflow) |
| :--- | :--- | :--- | :--- | :--- |
| **Model** | `qwen-3-235b...` | `qwen-3-235b...` | `gpt-4o` | `gpt-4o` |
| **Input Tokens** | 821 | 139 (**-83%**) | 810 | 128 (**-84%**) |

### Key Observations
- **Extreme Architecture Bloat Mitigation**: When using raw skills for dynamic orchestration (like querying an MCP tool connection state, reading schemas, and authorizing), the prompt size balloons massively. 
- **The Runeflow Advantage**: By handling MCP auth checks through native execution branching, Runeflow avoids sending instructions about "how to behave" to the LLM, reducing the token overhead by over 80%.

---

## Conclusion

Runeflow is highly effective for **complex, context-heavy tasks** where input token reduction directly translates to cost savings and potentially faster model response times. For simple tasks, it maintains performance parity while providing the benefits of structured execution and artifact tracking.

> [!NOTE]
> All benchmarks were run using `node --env-file=.env` with providers evaluated in "both" mode.
