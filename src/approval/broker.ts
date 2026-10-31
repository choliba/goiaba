import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

import { UsageError } from '../errors';
import { processAlive } from '../execute/proc';
import {
  currentPid,
  goiabaCacheDir,
  runtimeExecutable,
} from '../execute/process';
import {
  ensureDirectory,
  listDirectory,
  modifiedAt,
  pathExists,
  readText,
  removePath,
  writeText,
  join,
} from '../filesystem/index';
import {
  CommandGate,
  type CommandDecision,
  type CommandGateOptions,
} from './gate';

export {
  type CommandApprovalRequest,
  type CommandApprover,
  type CommandDecision,
} from './gate';

export type ApprovalBrokerOptions = CommandGateOptions;

const HOOK_FILE = 'hook';
const OWNER_FILE = 'owner.pid';
const UNOWNED_GRACE_MS = 60_000;
const SOCKET_FILE = 'approval.sock';

/**
 * Host side of the execution gate: the PreToolUse hook inside the sandbox asks
 * it, over a unix socket, whether a shell command may run. The decision itself
 * is the `CommandGate`'s.
 */
export class ApprovalBroker {
  /** Directory mounted read-only in the sandbox: hook script and socket. */
  public readonly dir: string;

  private readonly gate: CommandGate;
  private server: Server | undefined;

  public constructor(options: ApprovalBrokerOptions) {
    this.gate = new CommandGate(options);
    removeAbandonedGates();
    this.dir = join(gatesDir(), randomUUID().slice(0, 8));
    this.createDir();
  }

  /** The gate's directory; again on every start, since close removes it. */
  private createDir(): void {
    ensureDirectory(this.dir, 0o700);
    // Who owns this gate, so a later run can clean it up if this one dies
    // without closing (SIGKILL, a forced exit).
    writeText(join(this.dir, OWNER_FILE), String(currentPid()));
  }

  /** argv the CLI runs as its PreToolUse hook, inside the sandbox. */
  public hookCommand(): readonly string[] {
    return [
      runtimeExecutable(),
      join(this.dir, HOOK_FILE),
      join(this.dir, SOCKET_FILE),
    ];
  }

  public setSession(id: string): void {
    this.gate.setSession(id);
  }

  public decide(command: string): Promise<CommandDecision> {
    return this.gate.decide(command);
  }

  public async start(): Promise<void> {
    if (this.server !== undefined) return;

    this.createDir();
    await bundleHook(this.dir);
    this.server = await listen(join(this.dir, SOCKET_FILE), (socket) => {
      serve(socket, (command) => this.gate.decide(command));
    });
  }

  public async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    await stopServer(server);
    removePath(this.dir);
  }
}

function gatesDir(): string {
  return join(goiabaCacheDir(), 'gate');
}

/** Gate directories whose owner process is gone (it died without closing). */
function removeAbandonedGates(): void {
  const dir = gatesDir();
  if (!pathExists(dir)) return;

  for (const name of listDirectory(dir)) {
    const gate = join(dir, name);
    if (isAbandoned(gate)) removePath(gate);
  }
}

function isAbandoned(gate: string): boolean {
  const owner = join(gate, OWNER_FILE);
  // No owner yet: a gate being created right now, or one from before the
  // owner file (old enough that nobody can be using it).
  if (!pathExists(owner)) {
    return Date.now() - modifiedAt(gate) > UNOWNED_GRACE_MS;
  }

  const pid = Number(readText(owner).trim());
  return !Number.isInteger(pid) || !processAlive(pid);
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

function stopServer(server: Server | undefined): Promise<void> {
  if (server === undefined) return Promise.resolve();

  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

/** One request per connection: a JSON line in, a JSON line out. */
function serve(
  socket: Socket,
  decide: (command: string) => Promise<CommandDecision>,
): void {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('error', () => undefined);
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    const newline = buffer.indexOf('\n');
    if (newline === -1) return;

    void answer(buffer.slice(0, newline), decide).then((response) => {
      socket.end(`${JSON.stringify(response)}\n`);
    });
    buffer = '';
  });
}

function answer(
  line: string,
  decide: (command: string) => Promise<CommandDecision>,
): Promise<CommandDecision> {
  const command = readCommand(line);

  if (command === undefined) {
    return Promise.resolve({
      decision: 'deny',
      reason: 'Pedido inválido ao gate de execução.',
    });
  }

  return decide(command);
}

function readCommand(line: string): string | undefined {
  try {
    const request: unknown = JSON.parse(line);
    const command =
      typeof request === 'object' && request !== null && 'command' in request
        ? request.command
        : undefined;
    return typeof command === 'string' ? command : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The hook runs inside the sandbox, where the project is not mounted: bundle
 * it (and what it imports) into one file in the gate's directory.
 */
async function bundleHook(dir: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [new URL('./hook-main.ts', import.meta.url).pathname],
    outdir: dir,
    naming: HOOK_FILE,
    target: 'bun',
  });

  if (!result.success) {
    throw new UsageError(
      `Não foi possível preparar o hook de execução: ${result.logs.map(String).join('; ')}`,
    );
  }
}
