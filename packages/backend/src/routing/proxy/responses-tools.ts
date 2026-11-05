import { createHash } from 'crypto';

type JsonRecord = Record<string, unknown>;
export interface ResponsesToolName {
  name: string;
  namespace?: string;
  /** A freeform Responses `custom` tool (Codex `apply_patch`), sent to Chat as a function. */
  custom?: true;
}

/** The single string argument a `custom` tool's function stand-in takes. */
const CUSTOM_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    input: { type: 'string', description: 'The raw tool input, exactly as the tool expects it.' },
  },
  required: ['input'],
  additionalProperties: false,
};

/** Arguments JSON of a custom tool call's function stand-in. */
export function customToolArguments(input: unknown): string {
  return JSON.stringify({ input: typeof input === 'string' ? input : '' });
}

/** The raw input back out of a custom tool's function arguments. */
export function customToolInput(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson) as { input?: unknown };
    return typeof parsed.input === 'string' ? parsed.input : argumentsJson;
  } catch {
    return argumentsJson;
  }
}
export type ResponsesToolNames = ReadonlyMap<string, ResponsesToolName>;

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function alias(namespace: string, name: string, salt = 0): string {
  const prefix = `${namespace}__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  const hash = createHash('sha256')
    .update(JSON.stringify([namespace, name, salt]))
    .digest('hex');
  return `${prefix}_${hash.slice(0, 24)}`;
}

/** Request-scoped reverse lookup. Never send this metadata to the provider. */
export function responsesToolNames(tools: unknown): ResponsesToolNames {
  const names = new Map<string, ResponsesToolName>();
  if (!Array.isArray(tools)) return names;
  const reserved = new Set(
    tools
      .filter(isRecord)
      .filter((tool) => tool.type === 'function')
      .map((tool) => tool.name),
  );
  for (const tool of tools) {
    if (!isRecord(tool) || tool.type !== 'namespace' || typeof tool.name !== 'string') continue;
    if (!Array.isArray(tool.tools)) continue;
    for (const fn of tool.tools) {
      if (!isRecord(fn) || fn.type !== 'function' || typeof fn.name !== 'string') continue;
      let name = alias(tool.name, fn.name);
      // A caller can also declare a top-level function whose name matches our alias.
      let salt = 0;
      while (reserved.has(name)) name = alias(tool.name, fn.name, ++salt);
      names.set(name, { name: fn.name, namespace: tool.name });
    }
  }
  for (const tool of tools) {
    if (isRecord(tool) && tool.type === 'function' && typeof tool.name === 'string') {
      names.set(tool.name, { name: tool.name });
    }
    if (isRecord(tool) && tool.type === 'custom' && typeof tool.name === 'string') {
      names.set(tool.name, { name: tool.name, custom: true });
    }
  }
  return names;
}

export function chatToolName(item: JsonRecord, names: ResponsesToolNames): string {
  const name = typeof item.name === 'string' ? item.name : 'unknown';
  if (typeof item.namespace !== 'string' || !item.namespace) return name;
  for (const [wireName, original] of names) {
    if (original.name === name && original.namespace === item.namespace) return wireName;
  }
  // Historical calls remain replayable even when their tool is no longer advertised.
  return alias(item.namespace, name);
}

export function chatTools(tools: unknown[], names: ResponsesToolNames): JsonRecord[] {
  return tools.filter(isRecord).flatMap((tool) => {
    if (tool.type === 'namespace' && Array.isArray(tool.tools)) {
      return chatTools(
        tool.tools.filter(isRecord).map((fn) => ({ ...fn, namespace: tool.name })),
        names,
      );
    }
    if (tool.type === 'custom' && typeof tool.name === 'string') {
      // harness-codex G2: a freeform tool becomes a one-string-argument function.
      const format = isRecord(tool.format) ? tool.format : undefined;
      const grammar =
        format && typeof format.definition === 'string'
          ? `\n\nInput format (${String(format.syntax ?? format.type)}):\n${format.definition}`
          : '';
      return [
        {
          type: 'function',
          function: {
            name: tool.name,
            description: `${typeof tool.description === 'string' ? tool.description : ''}${grammar}`,
            parameters: CUSTOM_TOOL_PARAMETERS,
          },
        },
      ];
    }
    if (tool.type !== 'function') return [];
    return [
      {
        type: 'function',
        function: {
          name: chatToolName(tool, names),
          ...(tool.description !== undefined && { description: tool.description }),
          ...(tool.parameters !== undefined && { parameters: tool.parameters }),
          ...(tool.strict !== undefined && { strict: tool.strict }),
        },
      },
    ];
  });
}
