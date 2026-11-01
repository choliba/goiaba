import type { RunContext } from '../context/index';

/**
 * The log contract, whatever package writes it: ECS for the record
 * (`@timestamp`, `log.level`, `trace`, `transaction`, `message`, `user`) and
 * OpenTelemetry semantic names for what each event carries (`event.name`,
 * `gen_ai.*`, `process.*`, `error.*`). Goiaba's own fields go in `goiaba.*`.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  /** ISO date and time it was reported. */
  readonly timestamp: string;
  readonly level: LogLevel;
  /** A short sentence; the conversation text goes in `goiaba.content`. */
  readonly message: string;
  /** Nested ECS/OTel fields: `{ event: { name }, gen_ai: { … }, … }`. */
  readonly fields: Readonly<Record<string, unknown>>;
}

/** What a producer logged, with when and who was running. */
export interface LogEntry extends RunContext {
  readonly ts: string;
  /** None for `info`. */
  readonly level?: 'debug' | 'error';
  readonly type: string;
  readonly [key: string]: unknown;
}

/** What every record of one log carries. */
export interface LogContext {
  /** One per open log: one run of the script. */
  readonly traceId: string;
  readonly userName: string;
}

type Fields = Record<string, unknown>;

/** Fields with a standard name; the rest goes in `goiaba.*`. */
const FIELD_NAMES: Readonly<Record<string, readonly string[]>> = {
  type: ['event', 'name'],
  agent: ['gen_ai', 'agent', 'name'],
  run: ['transaction', 'id'],
  // The provider's id (`ollama-codex`); its name and model come from the agent.
  provider: ['goiaba', 'provider_id'],
  session: ['gen_ai', 'conversation', 'id'],
  model: ['gen_ai', 'request', 'model'],
  tool: ['gen_ai', 'tool', 'name'],
  call_id: ['gen_ai', 'tool', 'call', 'id'],
  args: ['gen_ai', 'tool', 'call', 'arguments'],
  result: ['gen_ai', 'tool', 'call', 'result'],
  executable: ['process', 'executable'],
  arguments: ['process', 'args'],
  cwd: ['process', 'working_directory'],
  pid: ['process', 'pid'],
  code: ['process', 'exit_code'],
  commandLine: ['process', 'command_line'],
  duration: ['event', 'duration'],
};

/** What the person and the agent said: content, not metadata. */
const CONTENT_FIELDS = new Set(['value', 'input', 'question', 'text']);

/** Events that are a failure: their `message` is the error's. */
const ERROR_EVENTS = new Set(['error', 'tool_error']);

export function toLogRecord(entry: LogEntry, context: LogContext): LogRecord {
  const { ts, level, type, ...rest } = entry;
  const fields: Fields = {
    trace: { id: context.traceId },
    user: { name: context.userName },
  };

  setField(fields, ['event', 'name'], type);

  const { agentProvider, ...reported } = rest;
  if (agentProvider !== undefined) {
    setField(fields, ['gen_ai', 'provider', 'name'], agentProvider.name);
    setField(fields, ['gen_ai', 'request', 'model'], agentProvider.model);
    // Not an OpenTelemetry name: which CLI the provider drives.
    if (agentProvider.cli !== undefined) {
      setField(fields, ['goiaba', 'cli'], agentProvider.cli);
    }
  }

  for (const [key, value] of Object.entries(reported)) {
    if (value === undefined) continue;
    setField(fields, fieldPath(type, key, value), value);
  }

  return {
    timestamp: ts,
    level: level ?? 'info',
    message: messageOf(entry),
    fields,
  };
}

function fieldPath(type: string, key: string, value: unknown): string[] {
  // `session` reports its id as `id`.
  if (type === 'session' && key === 'id') {
    return ['gen_ai', 'conversation', 'id'];
  }

  if (key === 'message' && ERROR_EVENTS.has(type)) return ['error', 'message'];
  // The gate's decision is about a shell command line.
  if (key === 'command' && typeof value === 'string') {
    return ['process', 'command_line'];
  }
  if (CONTENT_FIELDS.has(key)) return ['goiaba', 'content'];

  return [...(FIELD_NAMES[key] ?? ['goiaba', key])];
}

function setField(fields: Fields, path: readonly string[], value: unknown) {
  let target = fields;

  for (const key of path.slice(0, -1)) {
    const next = target[key];
    const child: Fields = isFields(next) ? next : {};
    target[key] = child;
    target = child;
  }

  target[path.at(-1) ?? ''] = value;
}

function messageOf(entry: LogEntry): string {
  const text = (key: string): string => {
    const value = entry[key];
    return typeof value === 'string' ? value : '';
  };

  switch (entry.type) {
    case 'input':
      return 'Entrada enviada ao agente';
    case 'resume':
      return 'Sessão retomada';
    case 'session':
      return 'Sessão iniciada';
    case 'output':
      return 'Saída do agente';
    case 'ask':
      return 'Pergunta do agente';
    case 'answer':
      return 'Resposta recebida';
    case 'approved':
      return 'Aprovação recebida';
    case 'message':
      return 'Mensagem exibida';
    case 'tool':
      return `Ferramenta chamada: ${text('tool')}`;
    case 'tool_result':
      return `Resultado da ferramenta: ${text('tool')}`;
    case 'tool_error':
      return `Falha da ferramenta: ${text('tool')}`;
    case 'command':
      return `Comando ${text('phase')}: ${text('executable')}`;
    case 'command_decision':
      return `Comando ${text('decision') === 'allow' ? 'permitido' : 'negado'}: ${text('command')}`;
    case 'sandbox':
      return `Sandbox ${text('sandbox')}`;
    case 'provider-noise':
      return 'Saída ignorada do provider';
    case 'agent_config':
      return 'Configuração do agente';
    case 'error':
      return text('message') || 'Erro';
    default:
      return entry.type;
  }
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
