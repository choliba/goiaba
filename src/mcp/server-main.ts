/**
 * The MCP server of an agent's own tools, started by its CLI inside the
 * sandbox: `<runtime> server <socket>`. The protocol is the SDK's
 * (`serveTools`, server.ts); the tools and each call are asked of the
 * Goiaba, over the socket (broker.ts). Bundled into one file by the broker.
 */

import { connect } from 'node:net';

import { programArguments } from '../execute/process';
import { TOOL_CALL_MS, TOOL_SERVER, TOOL_SERVER_VERSION } from './constants';
import { serveTools, type McpTool } from './server';

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

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).find(([name]) => name === key)?.[1]
    : undefined;

/** A tool the Goiaba listed, when it has the shape of one. */
function toolOf(value: unknown): McpTool | undefined {
  const name = field(value, 'name');
  const description = field(value, 'description');
  const inputSchema = field(value, 'inputSchema');
  if (
    typeof name !== 'string' ||
    typeof description !== 'string' ||
    typeof inputSchema !== 'object' ||
    inputSchema === null ||
    field(inputSchema, 'type') !== 'object'
  ) {
    return undefined;
  }
  return {
    name,
    description,
    inputSchema: { ...inputSchema, type: 'object' },
  };
}

await serveTools(
  { name: TOOL_SERVER, version: TOOL_SERVER_VERSION },
  {
    list: async () => {
      const tools = field(await ask({ op: 'list' }), 'tools');
      return Array.isArray(tools)
        ? tools.flatMap((tool) => toolOf(tool) ?? [])
        : [];
    },
    call: async (name, input) => {
      const reply = await ask({ op: 'call', name, input });
      const text = field(reply, 'text');
      return {
        text: typeof text === 'string' ? text : '',
        isError: field(reply, 'isError') === true,
      };
    },
  },
);
