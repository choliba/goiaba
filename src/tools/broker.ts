/**
 * The Goiaba's side of an agent's own tools: the MCP server inside the
 * sandbox (server-main.ts, bundled next to the socket) asks it, over a unix
 * socket, which tools there are and to call one. Here the policy decides
 * (a tool it does not allow is not even listed), the input is checked
 * against the tool's schema, and `run` executes, in this process.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

import { UsageError } from '../errors';
import { currentPid, environment, runtimeExecutable } from '../execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
  writeText,
} from '../filesystem/index';
import type { AgentPolicy } from '../policy/policy.interface';
import { wildmatch } from '../policy/wildmatch';
import { TOOL_SERVER } from './constants';
import type { AgentTool } from './index';
import { inputProblem, isRecord } from './schema';

const SERVER_FILE = 'server';
const SOCKET_FILE = 'tools.sock';
const OWNER_FILE = 'owner.pid';

/** How a provider's CLI starts the MCP server: its name and its argv. */
export interface ToolServer {
  /** `goiaba`: the MCP server's name, the prefix of its tools. */
  readonly name: string;
  /** argv of the server, runnable inside the sandbox. */
  readonly command: readonly string[];
}

/** A request from the MCP server: list the tools, or call one. */
type Request =
  | { readonly op: 'list' }
  | { readonly op: 'call'; readonly name: string; readonly input: unknown };

/** What a call gives back to the model: text, and whether it failed. */
interface CallResult {
  readonly text: string;
  readonly isError: boolean;
}

/** Whether the policy lets the agent call `goiaba/<name>`. */
function allowedBy(policy: AgentPolicy | undefined, name: string): boolean {
  if (policy === undefined) return true;
  const key = `${TOOL_SERVER}/${name}`;
  const matches = (source: 'allow' | 'deny' | 'requireApproval'): boolean =>
    (policy[source]?.tools ?? []).some(
      (rule) =>
        (rule.operations.includes('*') || rule.operations.includes('call')) &&
        rule.tools.some((pattern) => wildmatch(key, pattern)) &&
        !(rule.ignores?.tools ?? []).some((pattern) => wildmatch(key, pattern)),
    );
  if (matches('deny')) return false;
  // Nobody can approve a call from inside the MCP server: asking is denying.
  if (matches('requireApproval')) return false;
  if (matches('allow')) return true;
  return policy.default === 'allow';
}

export class ToolBroker {
  /** Directory mounted read-only in the sandbox: the server and the socket. */
  public readonly dir: string;

  private readonly tools: readonly AgentTool[];
  private readonly policy: AgentPolicy | undefined;
  private server: Server | undefined;

  public constructor({
    tools,
    policy,
  }: {
    readonly tools: readonly AgentTool[];
    readonly policy: AgentPolicy | undefined;
  }) {
    this.tools = tools;
    this.policy = policy;
    this.dir = join(
      goiabaCacheDir(environment()),
      'tools',
      randomUUID().slice(0, 8),
    );
    this.createDir();
  }

  private createDir(): void {
    ensureDirectory(this.dir, 0o700);
    writeText(join(this.dir, OWNER_FILE), String(currentPid()));
  }

  /** How the CLI starts the MCP server, inside the sandbox. */
  public serverCommand(): ToolServer {
    return {
      name: TOOL_SERVER,
      command: [
        runtimeExecutable(),
        join(this.dir, SERVER_FILE),
        join(this.dir, SOCKET_FILE),
      ],
    };
  }

  /** The tools the agent may call: the declared ones the policy allows. */
  public allowed(): readonly AgentTool[] {
    return this.tools.filter((tool) => allowedBy(this.policy, tool.name));
  }

  /** Calls one tool, as the model asked: checked by the policy and the schema. */
  public async call(name: string, input: unknown): Promise<CallResult> {
    const found = this.allowed().find((tool) => tool.name === name);
    if (found === undefined) {
      return {
        text: `A ferramenta ${name} não existe para este agente ou a política não a libera.`,
        isError: true,
      };
    }
    const problem = inputProblem(found.input, input);
    if (problem !== undefined || !isRecord(input)) {
      return {
        text: problem ?? 'A entrada deve ser um objeto.',
        isError: true,
      };
    }
    try {
      const output = await found.run(input);
      return {
        text: typeof output === 'string' ? output : JSON.stringify(output),
        isError: false,
      };
    } catch (error) {
      return {
        text: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  public async start(): Promise<void> {
    if (this.server !== undefined) return;
    this.createDir();
    await bundleServer(this.dir);
    this.server = await listen(join(this.dir, SOCKET_FILE), (socket) => {
      serve(socket, (request) => this.answer(request));
    });
  }

  public async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server !== undefined) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    removePath(this.dir);
  }

  private async answer(request: Request): Promise<unknown> {
    if (request.op === 'list') {
      return {
        tools: this.allowed().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.input,
        })),
      };
    }
    return this.call(request.name, request.input);
  }
}

function listen(
  socketPath: string,
  onConnection: (socket: Socket) => void,
): Promise<Server> {
  const server = createServer(onConnection);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

/** A request read from a line; `undefined` when it is not one. */
function readRequest(line: string): Request | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null || !('op' in value)) {
      return undefined;
    }
    if (value.op === 'list') return { op: 'list' };
    if (
      value.op === 'call' &&
      'name' in value &&
      typeof value.name === 'string'
    ) {
      return {
        op: 'call',
        name: value.name,
        input: 'input' in value ? value.input : undefined,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** One request per connection: a JSON line in, a JSON line out. */
function serve(
  socket: Socket,
  answer: (request: Request) => Promise<unknown>,
): void {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('error', () => undefined);
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    const newline = buffer.indexOf('\n');
    if (newline === -1) return;
    const request = readRequest(buffer.slice(0, newline));
    buffer = '';
    const reply =
      request === undefined
        ? Promise.resolve({ text: 'Pedido inválido.', isError: true })
        : answer(request);
    void reply.then((response) => {
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
}

/**
 * The MCP server runs inside the sandbox, where the project is not mounted:
 * bundled (with what it imports) into one file in the broker's directory.
 */
async function bundleServer(dir: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [new URL('./server-main.ts', import.meta.url).pathname],
    outdir: dir,
    naming: SERVER_FILE,
    target: 'bun',
  });
  if (!result.success) {
    throw new UsageError(
      `Não foi possível preparar o servidor das ferramentas: ${result.logs.map(String).join('; ')}`,
    );
  }
}
