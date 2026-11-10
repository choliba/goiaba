/**
 * The MCP server of an agent's own tools, started by its CLI inside the
 * sandbox: `<runtime> server <socket>`. It speaks MCP (JSON-RPC 2.0, one
 * message per line on stdio) and asks the Goiaba, over the socket, for the
 * tools and for each call (broker.ts). Bundled into one file by the broker.
 */

import { connect } from 'node:net';

import { readStream } from '../input/index';
import { programArguments } from '../execute/process';
import { writeOut } from '../output/stdio';
import { MCP_PROTOCOL_VERSION, TOOL_CALL_MS, TOOL_SERVER } from './constants';

const socketPath = programArguments()[0] ?? '';

/** One request to the Goiaba: a JSON line out, a JSON line back. */
function ask(request: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('O Goiaba não respondeu a tempo.'));
    }, TOOL_CALL_MS);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
    });
    socket.on('end', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buffer));
      } catch {
        reject(new Error('Resposta inválida do Goiaba.'));
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function send(message: object): void {
  writeOut(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).find(([name]) => name === key)?.[1]
    : undefined;

/** The answer to one JSON-RPC request; `undefined` for a notification. */
async function handle(message: unknown): Promise<void> {
  const id = field(message, 'id');
  const method = field(message, 'method');
  const params = field(message, 'params');
  // A notification (no id): nothing to answer.
  if (id === undefined) return;
  try {
    if (method === 'initialize') {
      send({
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: TOOL_SERVER, version: '1' },
        },
      });
    } else if (method === 'tools/list') {
      send({ id, result: await ask({ op: 'list' }) });
    } else if (method === 'tools/call') {
      const reply = await ask({
        op: 'call',
        name: field(params, 'name'),
        input: field(params, 'arguments') ?? {},
      });
      const text = field(reply, 'text');
      send({
        id,
        result: {
          content: [
            { type: 'text', text: typeof text === 'string' ? text : '' },
          ],
          isError: field(reply, 'isError') === true,
        },
      });
    } else if (method === 'ping') {
      send({ id, result: {} });
    } else {
      send({
        id,
        error: {
          code: -32601,
          message: `Método desconhecido: ${String(method)}`,
        },
      });
    }
  } catch (error) {
    send({
      id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

let buffer = '';
for await (const piece of readStream()) {
  buffer += piece;
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line.length > 0) {
      try {
        void handle(JSON.parse(line));
      } catch {
        send({ id: null, error: { code: -32700, message: 'JSON inválido.' } });
      }
    }
    newline = buffer.indexOf('\n');
  }
}
