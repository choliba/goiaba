/**
 * PreToolUse hook run by the agent's CLI (Claude Code or Codex) inside the
 * sandbox. The broker bundles it into one file next to its socket
 * (`bundleHook`), so it may import the project. Usage: `<runtime> hook <socket>`.
 *
 * Fails closed: anything other than an explicit `allow` from the broker
 * denies. A policy denial is a JSON `deny` with exit 0 (honored by both CLIs);
 * an internal failure also prints `deny` and exits 2 (Claude: blocking error).
 */
import { connect } from 'node:net';

import { exitProgram, programArguments } from '../execute/process';
import { read } from '../input/index';
import { StdioAdapter } from '../adapters/stdio/index';
import { Conversation } from '../interaction/index';

const TIMEOUT_MS = 55 * 60 * 1000;

interface Decision {
  readonly decision: 'allow' | 'deny';
  readonly reason: string;
}

const io = new Conversation(new StdioAdapter());

function reply({ decision, reason }: Decision): void {
  io.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
}

function fail(reason: string): never {
  reply({ decision: 'deny', reason });
  io.error(reason);
  return exitProgram(2);
}

async function readCommand(): Promise<string> {
  const input: unknown = JSON.parse(await read());
  const tool =
    typeof input === 'object' && input !== null && 'tool_input' in input
      ? input.tool_input
      : undefined;
  const command =
    typeof tool === 'object' && tool !== null && 'command' in tool
      ? tool.command
      : undefined;

  if (typeof command === 'string') return command;
  // Codex may send the argv form.
  if (
    Array.isArray(command) &&
    command.every((part) => typeof part === 'string')
  ) {
    return command.join(' ');
  }

  return fail('Pedido do hook sem comando: bloqueado pela política do agente.');
}

function ask(socketPath: string, command: string): Promise<Decision> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('O gate de execução não respondeu a tempo.'));
    }, TIMEOUT_MS);

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ command })}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
    });
    socket.on('end', () => {
      clearTimeout(timer);
      const decision = readDecision(buffer);
      if (decision === undefined) {
        reject(new Error('Resposta inválida do gate de execução.'));
        return;
      }
      resolve(decision);
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function readDecision(text: string): Decision | undefined {
  let response: unknown;

  try {
    response = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (
    typeof response !== 'object' ||
    response === null ||
    !('decision' in response) ||
    !('reason' in response) ||
    typeof response.reason !== 'string'
  ) {
    return undefined;
  }

  const { decision, reason } = response;
  return decision === 'allow' || decision === 'deny'
    ? { decision, reason }
    : undefined;
}

const socketPath = programArguments().at(0);

if (socketPath === undefined) {
  fail('Hook sem o caminho do gate de execução.');
}

try {
  reply(await ask(socketPath, await readCommand()));
} catch (error) {
  fail(
    `Gate de execução indisponível (${error instanceof Error ? error.message : String(error)}): bloqueado.`,
  );
}
