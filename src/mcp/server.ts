/**
 * An MCP server of tools, over stdio, made with the official SDK
 * (`@modelcontextprotocol/server`): it answers the protocol (the handshake,
 * the versions, `ping`, errors) and leaves to `handlers` only which tools
 * there are and what a call gives. The SDK stays here: nothing else in the
 * Goiaba imports it.
 */

import { Server } from '@modelcontextprotocol/server';

import { StdioTransport } from './transport';

/** A tool as the model sees it: its name, what it does, its input. */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  /** A JSON Schema of an object: `{ type: 'object', properties, required }`. */
  readonly inputSchema: {
    readonly type: 'object';
    readonly [key: string]: unknown;
  };
}

/** What a call gives back to the model: text, and whether it failed. */
export interface McpToolResult {
  readonly text: string;
  readonly isError: boolean;
}

/** Where the server's answers come from. */
export interface McpToolHandlers {
  list(): Promise<readonly McpTool[]>;
  call(
    name: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<McpToolResult>;
}

/**
 * Serves `handlers`' tools over stdio until the client goes away (stdin
 * closes). `info` is how the server introduces itself in the handshake.
 */
export async function serveTools(
  info: { readonly name: string; readonly version: string },
  handlers: McpToolHandlers,
): Promise<void> {
  const server = new Server(
    { name: info.name, version: info.version },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler('tools/list', async () => ({
    tools: (await handlers.list()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: { ...tool.inputSchema },
    })),
  }));
  server.setRequestHandler('tools/call', async (request) => {
    const result = await handlers.call(
      request.params.name,
      request.params.arguments ?? {},
    );
    return {
      content: [{ type: 'text', text: result.text }],
      isError: result.isError,
    };
  });
  const transport = new StdioTransport();
  await server.connect(transport);
  await transport.done;
}
