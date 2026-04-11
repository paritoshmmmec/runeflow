// Type definitions for runeflow
// Definitions by: Runeflow Contributors

// ─── Core Data Structures ─────────────────────────────────────────────────────

/** Schema type in Runeflow DSL (short form or JSON Schema). */
export type SchemaValue =
  | "string"
  | "number"
  | "boolean"
  | "any"
  | "object"
  | SchemaValue[]
  | { [key: string]: SchemaValue }
  | {
      type: string;
      properties?: Record<string, SchemaValue>;
      items?: SchemaValue;
      required?: string[];
      additionalProperties?: boolean;
    };

/** LLM configuration for a skill or step. */
export interface LlmConfig {
  provider: string;
  model?: string;
  router?: boolean;
}

/** A single step in a runeflow workflow. */
export interface Step {
  id: string;
  kind: "tool" | "llm" | "branch" | "transform" | "cli" | "human_input" | "parallel" | "block" | "fail";
  tool?: string;
  with?: Record<string, unknown>;
  out?: SchemaValue;
  prompt?: string;
  input?: unknown;
  schema?: SchemaValue;
  command?: string;
  message?: string;
  if?: string;
  then?: string;
  else?: string;
  expr?: string;
  block?: string;
  steps?: string[];
  choices?: string[];
  default?: unknown;
  docs?: string;
  retry?: number;
  fallback?: string;
  next?: string;
  skip_if?: string;
  cache?: boolean;
  allow_failure?: boolean;
  llm?: LlmConfig;
}

/** Workflow definition containing steps and output mapping. */
export interface Workflow {
  steps: Step[];
  output: Record<string, unknown>;
}

/** Parsed skill metadata from YAML frontmatter. */
export interface Metadata {
  name: string;
  description: string;
  version?: string;
  inputs: Record<string, SchemaValue>;
  outputs: Record<string, SchemaValue>;
  llm?: LlmConfig | null;
  mcp_servers?: Record<string, McpServerConfig> | null;
  composio?: ComposioConfig | null;
}

/** MCP server configuration from frontmatter. */
export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  idleTimeoutMs?: number;
}

/** Composio configuration from frontmatter. */
export interface ComposioConfig {
  tools?: string[];
  toolkits?: string[];
  entity_id?: string;
  user_id?: string;
  connected_account_id?: string;
}

/** A fully parsed runeflow definition. */
export interface RuneflowDefinition {
  metadata: Metadata;
  docs: string;
  docBlocks: Record<string, string>;
  workflow: Workflow;
  consts?: Record<string, unknown>;
  sourcePath?: string;
}

// ─── Runtime Types ────────────────────────────────────────────────────────────

/** Serialized error in artifacts. */
export interface SerializedError {
  name: string;
  message: string;
  stack: string | null;
}

/** Result of a single step execution. */
export interface StepRun {
  id: string;
  kind: string;
  status: "success" | "failed" | "skipped";
  outputs: Record<string, unknown> | null;
  error: SerializedError | null;
  attempts: number;
  started_at: string;
  finished_at: string;
  input_hash?: string;
  inputs?: Record<string, unknown>;
  artifact_path?: string;
  result_path?: string;
  projected_docs?: string;
  prompt?: unknown;
  choices?: string[];
  default_value?: unknown;
  hook_events?: unknown[];
}

/** Run status values. */
export type RunStatus = "running" | "success" | "halted_on_error" | "halted_on_input" | "failed";

/** Result of a full workflow run. */
export interface RunResult {
  run_id: string;
  runeflow: {
    name: string;
    version?: string;
  };
  status: RunStatus;
  inputs: Record<string, unknown>;
  steps: StepRun[];
  outputs: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
  error: SerializedError | null;
  artifact_path?: string;
  halted_step_id?: string;
  pending_input?: {
    step_id: string;
    prompt: string;
    choices?: string[];
    default?: unknown;
  };
}

/** Hook payloads. */
export interface BeforeStepPayload {
  runId: string;
  step: Step;
  state: RuntimeState;
}

export interface AfterStepPayload {
  runId: string;
  step: Step;
  stepRun: StepRun;
  state: RuntimeState;
}

export interface OnStepErrorPayload {
  runId: string;
  step: Step;
  error: SerializedError;
  attempts: number;
  state: RuntimeState;
}

/** Hook handlers. */
export interface Hooks {
  beforeStep?: (payload: BeforeStepPayload) => Promise<{ abort: boolean; reason?: string } | void>;
  afterStep?: (payload: AfterStepPayload) => Promise<void>;
  onStepError?: (payload: OnStepErrorPayload) => Promise<void>;
}

/** Runtime state available to expressions and tools. */
export interface RuntimeState {
  inputs: Record<string, unknown>;
  stepMap: Record<string, StepRun>;
  consts: Record<string, unknown>;
}

/** LLM handler function signature. */
export type LlmHandler = (params: {
  llm: LlmConfig;
  prompt: unknown;
  input: Record<string, unknown>;
  schema: SchemaValue;
  docs: string;
  step: Step;
  state: RuntimeState;
  context: {
    docs: string;
    metadata: Metadata;
    source_path: string | null;
  };
}) => Promise<Record<string, unknown>>;

/** Tool handler function signature. */
export type ToolHandler = (
  input: Record<string, unknown>,
  context: { step: Step; state: RuntimeState },
) => Promise<Record<string, unknown>>;

// ─── Plugin Types ─────────────────────────────────────────────────────────────

/** Tool registry entry. */
export interface ToolRegistryEntry {
  name: string;
  description?: string;
  tags?: string[];
  inputSchema?: SchemaValue;
  outputSchema?: SchemaValue;
}

/** A runtime plugin. */
export interface Plugin {
  name?: string;
  tools?: Record<string, ToolHandler>;
  llms?: Record<string, LlmHandler>;
  toolRegistry?: ToolRegistryEntry[] | Map<string, ToolRegistryEntry> | Record<string, ToolRegistryEntry>;
  close?: () => Promise<void>;
}

/** Runtime configuration object. */
export interface Runtime {
  tools?: Record<string, ToolHandler>;
  llms?: Record<string, LlmHandler>;
  hooks?: Hooks;
  plugins?: Plugin[];
  toolRegistry?: ToolRegistryEntry[] | Map<string, ToolRegistryEntry> | Record<string, ToolRegistryEntry>;
}

/** Runtime environment after plugin resolution. */
export interface RuntimeEnvironment {
  tools: Record<string, ToolHandler>;
  llms: Record<string, LlmHandler>;
  hooks?: Hooks;
  plugins: Plugin[];
  toolRegistry: Map<string, ToolRegistryEntry>;
}

// ─── Run Options ──────────────────────────────────────────────────────────────

export interface RunOptions {
  runsDir?: string;
  cwd?: string;
  force?: boolean;
  checkAuth?: boolean;
  priorSteps?: StepRun[];
  toolRegistry?: ToolRegistryEntry[];
  promptValues?: Record<string, string>;
  promptHandler?: (stepId: string, prompt: string, choices?: string[], defaultValue?: unknown) => Promise<string>;
}

export interface ValidateOptions {
  toolRegistry?: ToolRegistryEntry[];
  runtimeToolRegistry?: Map<string, ToolRegistryEntry>;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  warnings: string[];
}

// ─── Dryrun ───────────────────────────────────────────────────────────────────

export interface DryrunStepPlan {
  id: string;
  kind: string;
  status: "would_execute" | "would_branch" | "would_halt" | "skipped" | "handled_by_parallel";
  tool?: string;
  resolved_with?: Record<string, unknown>;
  resolved_prompt?: unknown;
  resolved_input?: unknown;
  resolved_command?: string;
  resolved_condition?: unknown;
  resolve_error?: string | null;
  schema?: SchemaValue;
  placeholder_outputs?: Record<string, unknown>;
  computed_outputs?: Record<string, unknown>;
  condition?: string;
  expr?: string;
  target?: string;
  then?: string;
  else?: string;
  children?: DryrunStepPlan[];
  parent?: string;
  reason?: string;
  retry?: number;
  fallback?: string;
  cache?: boolean;
  allow_failure?: boolean;
  docs?: string;
  resolved_choices?: string[];
  resolved_default?: unknown;
  resolved_message?: unknown;
}

export interface DryrunResult {
  valid: boolean;
  validation: ValidationResult;
  steps: DryrunStepPlan[];
  output: Record<string, unknown> | null;
  output_resolve_error?: string | null;
}

// ─── MCP Plugin Options ───────────────────────────────────────────────────────

export interface McpToolPluginOptions {
  serverName: string;
  prefix?: string;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: SchemaValue;
    outputSchema?: SchemaValue;
  }>;
  callTool: (params: {
    server: string;
    name: string;
    input: Record<string, unknown>;
  }) => Promise<{ content: unknown[]; isError: boolean }>;
}

export interface McpClientPluginOptions {
  serverName: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  stderr?: "pipe" | "inherit" | "ignore";
  prefix?: string;
  clientInfo?: { name: string; version: string };
  idleTimeoutMs?: number;
}

export interface McpHttpClientPluginOptions {
  serverName: string;
  url: string;
  headers?: Record<string, string>;
  prefix?: string;
  idleTimeoutMs?: number;
}

export interface ComposioToolPluginOptions {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: SchemaValue;
  }>;
  executeTool: (params: {
    name: string;
    input: Record<string, unknown>;
  }) => Promise<{ content: unknown[]; isError: boolean }>;
}

export interface ComposioClientPluginOptions {
  tools?: string[];
  toolkits?: string[];
  toolkitVersions?: Record<string, string>;
  executeDefaults?: {
    connectedAccountId?: string;
    userId?: string;
  };
  cwd?: string;
  createClient?: () => Promise<unknown>;
  client?: unknown;
}

// ─── Adapter Schema ───────────────────────────────────────────────────────────

export declare const ADAPTER_TOOL_RESULT_SCHEMA: {
  content: unknown[];
  isError: "boolean";
  raw: "any";
};

// ─── Public Functions ─────────────────────────────────────────────────────────

// Parser
export function parseRuneflow(source: string, options?: { sourcePath?: string }): RuneflowDefinition;
export function parseSkill(source: string, options?: { sourcePath?: string }): RuneflowDefinition;

// Validator
export function validateRuneflow(definition: RuneflowDefinition, options?: ValidateOptions): ValidationResult;
export function validateSkill(definition: RuneflowDefinition, options?: ValidateOptions): ValidationResult;

// Runtime
export function runRuneflow(
  definition: RuneflowDefinition,
  inputs: Record<string, unknown>,
  runtime?: Runtime,
  options?: RunOptions,
): Promise<RunResult>;
export function runSkill(
  definition: RuneflowDefinition,
  inputs: Record<string, unknown>,
  runtime?: Runtime,
  options?: RunOptions,
): Promise<RunResult>;

// Dryrun
export function dryrunRuneflow(
  definition: RuneflowDefinition,
  inputs?: Record<string, unknown>,
  runtime?: Runtime,
  options?: { toolRegistry?: ToolRegistryEntry[] },
): Promise<DryrunResult>;
export function dryrunSkill(
  definition: RuneflowDefinition,
  inputs?: Record<string, unknown>,
  runtime?: Runtime,
  options?: { toolRegistry?: ToolRegistryEntry[] },
): Promise<DryrunResult>;

// Assembler
export function assembleRuneflow(
  definition: RuneflowDefinition,
  stepId: string,
  inputs?: Record<string, unknown>,
  runtime?: Runtime,
  options?: { cwd?: string },
): Promise<string>;
export function assembleSkill(
  definition: RuneflowDefinition,
  stepId: string,
  inputs?: Record<string, unknown>,
  runtime?: Runtime,
  options?: { cwd?: string },
): Promise<string>;

// Importer
export function importMarkdownRuneflow(source: string, options?: { sourcePath?: string }): string;
export function importMarkdownSkill(source: string, options?: { sourcePath?: string }): string;

// Blocks
export function resolveWorkflowBlocks(workflow: Workflow): Workflow;

// Default Runtime
export function createDefaultRuntime(): Runtime;

// Plugins
export function createMcpToolPlugin(options: McpToolPluginOptions): Plugin;
export function createMcpClientPlugin(options: McpClientPluginOptions): Promise<Plugin>;
export function createMcpHttpClientPlugin(options: McpHttpClientPluginOptions): Promise<Plugin>;
export function createComposioToolPlugin(options: ComposioToolPluginOptions): Plugin;
export function createComposioClientPlugin(options: ComposioClientPluginOptions): Promise<Plugin>;
export function createRuntimeEnvironment(runtime?: Runtime, options?: Record<string, unknown>): RuntimeEnvironment;
export function closeRuntimePlugins(runtime: RuntimeEnvironment): Promise<void>;
export function collectRuntimeExtensions(runtime?: Runtime, options?: Record<string, unknown>): RuntimeEnvironment;

// ─── Test Runner ──────────────────────────────────────────────────────────────

/** Mock return value for a tool or llm step. Can be an object or a function. */
export type MockValue<TInput = Record<string, unknown>, TOutput = Record<string, unknown>> =
  | TOutput
  | ((input: TInput) => TOutput | Promise<TOutput>);

/**
 * Fixture object for `runeflow test`.
 *
 * Omitted top-level sections are treated as empty objects by `loadFixture`.
 *
 * - `inputs`: skill input values
 * - `mocks.tools`: keyed by tool name, return value or factory function
 * - `mocks.llm`: keyed by step ID, return value or factory function
 * - `expect`: assertions on status, outputs, and/or per-step outcomes
 */
export interface RuneflowFixture {
  inputs?: Record<string, unknown>;
  mocks?: {
    tools?: Record<string, MockValue>;
    llm?: Record<string, MockValue>;
  };
  expect?: {
    status?: RunStatus;
    outputs?: Record<string, unknown>;
    steps?: Record<string, Partial<StepRun>>;
  };
}

/** A single assertion failure from a test run. */
export interface TestFailure {
  path: string;
  expected: unknown;
  actual: unknown;
  message: string;
}

/** Result of a `runTest` call. */
export interface TestResult {
  /** True if all assertions in `fixture.expect` passed. */
  pass: boolean;
  /** List of assertion failures (empty if pass === true). */
  failures: TestFailure[];
  /** The underlying `RunResult` (null if the skill threw before completing). */
  run: RunResult | null;
  /** Log of tool calls made during the run, keyed by step ID. */
  toolCallsByStep: Record<string, Record<string, unknown>[]>;
  /** Log of tool calls made during the run, keyed by tool name. */
  toolCalls: Record<string, Record<string, unknown>[]>;
  /** Log of LLM calls made during the run, keyed by step ID. */
  llmCalls: Record<string, { step: string; prompt: unknown; input: Record<string, unknown> }[]>;
}

export interface TestOptions {
  runsDir?: string;
  runtime?: Runtime;
}

/**
 * Runs a runeflow definition against a fixture, using mocked tools and LLMs.
 * No real API calls or shell commands are made.
 */
export function runTest(
  definition: RuneflowDefinition,
  fixture: RuneflowFixture,
  options?: TestOptions,
): Promise<TestResult>;

/**
 * Loads a fixture JSON file from the given path.
 */
export function loadFixture(fixturePath: string): Promise<RuneflowFixture>;
