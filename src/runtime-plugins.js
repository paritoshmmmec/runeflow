import { createBuiltinTools } from "./builtins.js";
import { resolveApiKey } from "./auth.js";
import { mergeToolRegistries, normalizeToolRegistry } from "./tool-registry.js";
import { isPlainObject } from "./utils.js";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const ADAPTER_TOOL_RESULT_SCHEMA = {
  content: ["any"],
  isError: "boolean",
  raw: "any",
};

function createAdapterOutputSchema(rawSchema) {
  if (!rawSchema) {
    return ADAPTER_TOOL_RESULT_SCHEMA;
  }

  return {
    content: ["any"],
    isError: "boolean",
    raw: rawSchema,
  };
}

const SUPPORTED_JSON_SCHEMA_KEYS = new Set([
  "type",
  "properties",
  "items",
  "required",
  "additionalProperties",
  "description",
]);

const DROPPED_JSON_SCHEMA_KEYS = new Set([
  "enum", "anyOf", "allOf", "oneOf", "not", "$ref", "const",
]);

function toSupportedSchema(schema, _path = "schema") {
  if (schema === null || schema === undefined) {
    return schema;
  }

  if (typeof schema === "string") {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => toSupportedSchema(item, _path));
  }

  if (!isPlainObject(schema)) {
    return schema;
  }

  const result = {};

  for (const [key, value] of Object.entries(schema)) {
    if (DROPPED_JSON_SCHEMA_KEYS.has(key)) {
      if (process.env.RUNEFLOW_DEBUG) {
        process.stderr.write(`[runeflow] toSupportedSchema: dropping unsupported key '${key}' at ${_path}\n`);
      }
      continue;
    }

    if (!SUPPORTED_JSON_SCHEMA_KEYS.has(key)) {
      continue;
    }

    if (key === "properties" && isPlainObject(value)) {
      result.properties = Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [childKey, toSupportedSchema(childValue, `${_path}.${childKey}`)]),
      );
      continue;
    }

    if (key === "items") {
      result.items = toSupportedSchema(value, `${_path}[]`);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function normalizePluginShape(plugin, source = "runtime plugin") {
  if (!isPlainObject(plugin)) {
    throw new Error(`${source} must be an object`);
  }

  if (plugin.tools !== undefined && !isPlainObject(plugin.tools)) {
    throw new Error(`${source}.tools must be an object`);
  }

  if (plugin.llms !== undefined && !isPlainObject(plugin.llms)) {
    throw new Error(`${source}.llms must be an object`);
  }

  return {
    name: typeof plugin.name === "string" && plugin.name.trim() ? plugin.name : source,
    tools: plugin.tools ?? {},
    llms: plugin.llms ?? {},
    toolRegistry: normalizeToolRegistry(plugin.toolRegistry),
    close: typeof plugin.close === "function" ? plugin.close : undefined,
  };
}

export function createBuiltinToolPlugin(options = {}) {
  return {
    name: "builtin-tools",
    tools: createBuiltinTools({ cwd: options.cwd }),
    toolRegistry: [],
  };
}

export function collectRuntimePlugins(runtime = {}, options = {}) {
  const runtimePlugins = Array.isArray(runtime.plugins) ? runtime.plugins : [];
  return [
    normalizePluginShape(createBuiltinToolPlugin(options), "builtin-tools"),
    ...runtimePlugins.map((plugin, index) => normalizePluginShape(plugin, `runtime.plugins[${index}]`)),
  ];
}

export function collectRuntimeExtensions(runtime = {}, options = {}) {
  const plugins = collectRuntimePlugins(runtime, options);
  const pluginTools = Object.assign({}, ...plugins.map((plugin) => plugin.tools ?? {}));
  const pluginLlms = Object.assign({}, ...plugins.map((plugin) => plugin.llms ?? {}));
  const pluginToolRegistry = mergeToolRegistries(
    ...plugins.map((plugin) => plugin.toolRegistry),
    runtime.toolRegistry,
  );

  return {
    plugins,
    tools: {
      ...pluginTools,
      ...(runtime.tools ?? {}),
    },
    llms: {
      ...pluginLlms,
      ...(runtime.llms ?? {}),
    },
    toolRegistry: pluginToolRegistry,
  };
}

export function createRuntimeEnvironment(runtime = {}, options = {}) {
  const extensions = collectRuntimeExtensions(runtime, options);

  return {
    ...runtime,
    plugins: extensions.plugins,
    tools: extensions.tools,
    llms: extensions.llms,
    toolRegistry: extensions.toolRegistry,
  };
}

export async function closeRuntimePlugins(runtime = {}) {
  const pluginClosers = (runtime.plugins ?? [])
    .map((plugin) => plugin?.close)
    .filter((closeFn) => typeof closeFn === "function");

  const results = await Promise.allSettled(pluginClosers.map((closeFn) => closeFn()));
  const firstFailure = results.find((result) => result.status === "rejected");

  if (firstFailure) {
    throw firstFailure.reason;
  }
}

function buildAdapterToolEntries(tools, buildName, buildDescription, metadataFactory) {
  return tools.map((tool, index) => {
    if (!isPlainObject(tool)) {
      throw new Error(`adapter tool[${index}] must be an object`);
    }

    if (typeof tool.name !== "string" || !tool.name.trim()) {
      throw new Error(`adapter tool[${index}] must declare a name`);
    }

    return {
      qualifiedName: buildName(tool),
      sourceName: tool.sourceName ?? tool.name,
      description: buildDescription(tool),
      inputSchema: toSupportedSchema(tool.inputSchema) ?? { type: "object", additionalProperties: true },
      outputSchema: createAdapterOutputSchema(toSupportedSchema(tool.outputSchema)),
      metadata: metadataFactory(tool),
    };
  });
}

function normalizeAdapterResult(result) {
  if (isPlainObject(result) && Array.isArray(result.content)) {
    return {
      content: result.content,
      isError: typeof result.isError === "boolean" ? result.isError : false,
      raw: "raw" in result ? result.raw : result,
    };
  }

  return {
    content: [result],
    isError: false,
    raw: result,
  };
}

function isMissingPackageError(error, packageName) {
  return error?.code === "ERR_MODULE_NOT_FOUND"
    || error?.message?.includes(`Cannot find package '${packageName}'`)
    || error?.message?.includes(`Cannot find package "${packageName}"`);
}

export function createMcpToolPlugin({
  serverName,
  tools = [],
  callTool,
  prefix = "mcp",
}) {
  if (typeof serverName !== "string" || !serverName.trim()) {
    throw new Error("createMcpToolPlugin requires a non-empty serverName");
  }

  if (typeof callTool !== "function") {
    throw new Error("createMcpToolPlugin requires a callTool function");
  }

  const entries = buildAdapterToolEntries(
    tools,
    (tool) => `${prefix}.${serverName}.${tool.name}`,
    (tool) => tool.description ?? `MCP tool '${tool.name}' from server '${serverName}'`,
    (tool) => ({
      adapter: "mcp",
      server: serverName,
      sourceTool: tool.name,
      outputConfidence: tool.outputSchema ? "declared" : "raw-envelope",
    }),
  );

  return {
    name: `mcp:${serverName}`,
    tools: Object.fromEntries(entries.map((entry) => [
      entry.qualifiedName,
      async (input, context) => normalizeAdapterResult(await callTool({
        server: serverName,
        name: entry.sourceName,
        input,
        step: context.step,
        state: context.state,
      })),
    ])),
    toolRegistry: entries.map((entry) => ({
      name: entry.qualifiedName,
      description: entry.description,
      inputSchema: entry.inputSchema,
      outputSchema: entry.outputSchema,
      metadata: entry.metadata,
    })),
  };
}

function createMcpClient(clientInfo = { name: "runeflow", version: "0.1.0" }) {
  return new Client(clientInfo);
}

// Shared session manager — accepts a buildTransport factory so stdio and HTTP
// can reuse the same idle-timeout / ref-counting logic.
function createManagedMcpSession(server, options = {}, buildTransport) {
  const idleTimeoutMs = options.idleTimeoutMs;
  let client = null;
  let transport = null;
  let connectPromise = null;
  let activeUsers = 0;
  let idleTimer = null;

  const cancelIdleClose = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const close = async () => {
    cancelIdleClose();

    if (connectPromise) {
      await connectPromise.catch(() => {});
    }

    connectPromise = null;

    const closingClient = client;
    const closingTransport = transport;
    client = null;
    transport = null;

    if (closingClient?.close) {
      await closingClient.close().catch(() => {});
    }

    if (closingTransport?.close) {
      await closingTransport.close().catch(() => {});
    }
  };

  const scheduleIdleClose = () => {
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 0) {
      return;
    }

    cancelIdleClose();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      void close();
    }, idleTimeoutMs);
    idleTimer.unref?.();
  };

  const ensureConnected = async () => {
    if (client) {
      return client;
    }

    if (connectPromise) {
      return connectPromise;
    }

    const nextClient = createMcpClient(server.clientInfo);
    const nextTransport = buildTransport(server);

    connectPromise = nextClient.connect(nextTransport)
      .then(() => {
        client = nextClient;
        transport = nextTransport;
        return nextClient;
      })
      .catch(async (error) => {
        await nextTransport.close().catch(() => {});
        throw error;
      })
      .finally(() => {
        connectPromise = null;
      });

    return connectPromise;
  };

  return {
    useClient: async (fn) => {
      cancelIdleClose();
      activeUsers += 1;

      try {
        const connectedClient = await ensureConnected();
        return await fn(connectedClient);
      } finally {
        activeUsers -= 1;
        if (activeUsers === 0) {
          scheduleIdleClose();
        }
      }
    },
    close,
  };
}

function buildStdioTransport(server) {
  return new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: server.cwd,
    stderr: server.stderr,
  });
}

function buildHttpTransport(server) {
  return new StreamableHTTPClientTransport(
    new URL(server.url),
    { requestInit: { headers: server.headers ?? {} } },
  );
}

export async function createMcpClientPlugin({
  serverName,
  command,
  args = [],
  env,
  cwd,
  stderr,
  prefix = "mcp",
  clientInfo,
  idleTimeoutMs,
}) {
  if (typeof serverName !== "string" || !serverName.trim()) {
    throw new Error("createMcpClientPlugin requires a non-empty serverName");
  }

  if (typeof command !== "string" || !command.trim()) {
    throw new Error("createMcpClientPlugin requires a command");
  }

  const server = {
    serverName,
    command,
    args,
    env,
    cwd,
    stderr,
    clientInfo,
  };

  const session = createManagedMcpSession(server, { idleTimeoutMs }, buildStdioTransport);

  const tools = await session.useClient(async (client) => {
    const result = await client.listTools();
    return result.tools ?? [];
  });

  const plugin = createMcpToolPlugin({
    serverName,
    prefix,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema ?? (tool.structuredOutputSchema ?? undefined),
    })),
    callTool: async ({ name, input }) => session.useClient(
      async (client) => client.callTool({
        name,
        arguments: input,
      }),
    ),
  });

  return {
    ...plugin,
    close: session.close,
  };
}

export async function createMcpHttpClientPlugin({
  serverName,
  url,
  headers,
  prefix = "mcp",
  clientInfo,
  idleTimeoutMs,
}) {
  if (typeof serverName !== "string" || !serverName.trim()) {
    throw new Error("createMcpHttpClientPlugin requires a non-empty serverName");
  }

  if (typeof url !== "string" || !url.trim()) {
    throw new Error("createMcpHttpClientPlugin requires a url");
  }

  const server = { serverName, url, headers, clientInfo };
  const session = createManagedMcpSession(server, { idleTimeoutMs }, buildHttpTransport);

  const tools = await session.useClient(async (client) => {
    const result = await client.listTools();
    return result.tools ?? [];
  });

  const plugin = createMcpToolPlugin({
    serverName,
    prefix,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema ?? tool.structuredOutputSchema ?? undefined,
    })),
    callTool: async ({ name, input }) => session.useClient(
      async (client) => client.callTool({ name, arguments: input }),
    ),
  });

  return {
    ...plugin,
    close: session.close,
  };
}

function extractComposioTools(result) {
  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result?.items)) {
    return result.items;
  }

  if (Array.isArray(result?.tools)) {
    return result.tools;
  }

  return [];
}

function normalizeComposioExecuteDefaults(executeDefaults = {}) {
  if (!isPlainObject(executeDefaults)) {
    return executeDefaults;
  }

  if (executeDefaults.userId) {
    return executeDefaults;
  }

  if (executeDefaults.entityId) {
    return {
      ...executeDefaults,
      userId: executeDefaults.entityId,
    };
  }

  if (executeDefaults.entity_id) {
    return {
      ...executeDefaults,
      userId: executeDefaults.entity_id,
    };
  }

  return executeDefaults;
}

function normalizeComposioToolName(sourceName, toolkitSlug) {
  if (typeof sourceName !== "string" || !sourceName.trim()) {
    throw new Error("Composio tool is missing a slug/name");
  }

  const trimmedSourceName = sourceName.trim();
  const normalizedToolkit = typeof toolkitSlug === "string" && toolkitSlug.trim()
    ? toolkitSlug.trim().toLowerCase()
    : null;

  if (normalizedToolkit) {
    const toolkitPrefix = `${normalizedToolkit.toUpperCase()}_`;
    if (trimmedSourceName.toUpperCase().startsWith(toolkitPrefix)) {
      return `${normalizedToolkit}.${trimmedSourceName.slice(toolkitPrefix.length).toLowerCase()}`;
    }
  }

  const firstUnderscore = trimmedSourceName.indexOf("_");
  if (firstUnderscore !== -1) {
    return `${trimmedSourceName.slice(0, firstUnderscore).toLowerCase()}.${trimmedSourceName.slice(firstUnderscore + 1).toLowerCase()}`;
  }

  // No underscore — always namespace under composio. to avoid collisions with builtins
  return `composio.${trimmedSourceName.toLowerCase()}`;
}

function mapComposioRawTool(tool, index) {
  if (!isPlainObject(tool)) {
    throw new Error(`Composio tool[${index}] must be an object`);
  }

  const sourceName = tool.slug ?? tool.name;
  const toolkitSlug = tool.toolkit?.slug ?? tool.toolkitSlug ?? tool.appName ?? tool.app?.slug ?? null;
  const normalizedName = normalizeComposioToolName(sourceName, toolkitSlug);
  const inputSchema = tool.inputSchema ?? tool.inputParameters ?? tool.parameters;
  const outputSchema = tool.outputSchema ?? tool.outputParameters ?? tool.responseSchema;

  return {
    name: normalizedName,
    sourceName,
    description: tool.description ?? `Composio tool '${sourceName}'`,
    inputSchema,
    outputSchema,
    metadata: {
      adapter: "composio",
      toolkit: toolkitSlug ?? null,
      sourceTool: sourceName,
      outputConfidence: outputSchema ? "declared" : "raw-envelope",
    },
  };
}

async function createComposioSdkClient({
  apiKey,
  toolkitVersions,
  fileDownloadDir,
  autoUploadDownloadFiles,
}) {
  try {
    const { Composio } = await import("@composio/core");
    return new Composio({
      apiKey,
      toolkitVersions,
      fileDownloadDir,
      autoUploadDownloadFiles,
    });
  } catch (error) {
    if (isMissingPackageError(error, "@composio/core")) {
      throw new Error(
        "Composio support requires '@composio/core'.\n" +
        "  Fix: npm install @composio/core",
      );
    }

    throw error;
  }
}

export async function createComposioClientPlugin({
  apiKey,
  toolkits,
  tools,
  limit,
  search,
  authConfigIds,
  prefix = "composio",
  executeDefaults = {},
  createClient,
  client,
  toolkitVersions,
  fileDownloadDir,
  autoUploadDownloadFiles,
  query = {},
  cwd,
}) {
  const resolvedApiKey = apiKey ?? (
    client || typeof createClient === "function"
      ? undefined
      : resolveApiKey("composio", "composio", { cwd })
  );

  const composioClient = client ?? (
    typeof createClient === "function"
      ? await createClient({
        apiKey: resolvedApiKey,
        toolkitVersions,
        fileDownloadDir,
        autoUploadDownloadFiles,
      })
      : await createComposioSdkClient({
        apiKey: resolvedApiKey,
        toolkitVersions,
        fileDownloadDir,
        autoUploadDownloadFiles,
      })
  );

  if (!composioClient?.tools || typeof composioClient.tools.getRawComposioTools !== "function") {
    throw new Error("createComposioClientPlugin requires a Composio client with tools.getRawComposioTools()");
  }

  if (typeof composioClient.tools.execute !== "function") {
    throw new Error("createComposioClientPlugin requires a Composio client with tools.execute()");
  }

  const normalizedExecuteDefaults = normalizeComposioExecuteDefaults(executeDefaults);

  const toolQuery = {
    ...query,
    ...(Array.isArray(toolkits) && toolkits.length > 0 ? { toolkits } : {}),
    ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
    ...(typeof limit === "number" ? { limit } : {}),
    ...(typeof search === "string" && search.trim() ? { search } : {}),
    ...(Array.isArray(authConfigIds) && authConfigIds.length > 0 ? { authConfigIds } : {}),
  };

  const discoveredTools = extractComposioTools(await composioClient.tools.getRawComposioTools(toolQuery));

  return createComposioToolPlugin({
    prefix,
    tools: discoveredTools.map(mapComposioRawTool),
    executeTool: async ({ name, input }) => composioClient.tools.execute(name, {
      ...normalizedExecuteDefaults,
      arguments: input,
    }),
  });
}

export function createComposioToolPlugin({
  tools = [],
  executeTool,
  prefix = "composio",
}) {
  if (typeof executeTool !== "function") {
    throw new Error("createComposioToolPlugin requires an executeTool function");
  }

  const entries = buildAdapterToolEntries(
    tools,
    (tool) => `${prefix}.${tool.name}`,
    (tool) => tool.description ?? `Composio tool '${tool.name}'`,
    (tool) => ({
      adapter: "composio",
      sourceTool: tool.name,
      outputConfidence: tool.outputSchema ? "declared" : "raw-envelope",
    }),
  );

  return {
    name: "composio",
    tools: Object.fromEntries(entries.map((entry) => [
      entry.qualifiedName,
      async (input, context) => normalizeAdapterResult(await executeTool({
        name: entry.sourceName,
        input,
        step: context.step,
        state: context.state,
      })),
    ])),
    toolRegistry: entries.map((entry) => ({
      name: entry.qualifiedName,
      description: entry.description,
      inputSchema: entry.inputSchema,
      outputSchema: entry.outputSchema,
      metadata: entry.metadata,
    })),
  };
}
