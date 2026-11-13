/**
 * The MCP SDK's transport over stdio, through the Goiaba's owners of it: the
 * messages come in by `readStream` (src/input) and go out by `writeOut`
 * (src/output), never straight to `process`. One JSON-RPC message per line,
 * as MCP's stdio transport defines. When stdin ends, the requests already
 * received are still answered before the transport says it closed: a client
 * that sends everything and closes stdin gets every answer.
 */

import {
  deserializeMessage,
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  serializeMessage,
  type JSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/server';

import { readStream } from '../input/index';
import { writeOut } from '../output/stdio';
import { TOOL_CALL_MS } from './constants';

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export class StdioTransport implements Transport {
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  private readonly stop = new AbortController();
  private finish: () => void = () => undefined;
  /** The ids of the requests received and not answered yet. */
  private readonly pending = new Set<string | number>();
  /** Called when `pending` empties, while stdin is over. */
  private drained: (() => void) | undefined;

  /** Fulfilled when the reading ends: stdin closed, or `close()`. */
  public readonly done = new Promise<void>((resolve) => {
    this.finish = resolve;
  });

  /** Starts reading stdin: each complete line is one message. */
  public start(): Promise<void> {
    void this.read();
    return Promise.resolve();
  }

  public send(message: JSONRPCMessage): Promise<void> {
    writeOut(serializeMessage(message));
    if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
      if (message.id !== undefined) this.pending.delete(message.id);
      if (this.pending.size === 0) this.drained?.();
    }
    return Promise.resolve();
  }

  public close(): Promise<void> {
    this.stop.abort();
    return Promise.resolve();
  }

  private async read(): Promise<void> {
    let buffer = '';
    try {
      for await (const piece of readStream({ signal: this.stop.signal })) {
        buffer += piece;
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (line.trim().length > 0) this.receive(line);
          newline = buffer.indexOf('\n');
        }
      }
    } catch (error) {
      if (!this.stop.signal.aborted) this.onerror?.(asError(error));
    } finally {
      await this.answered();
      this.onclose?.();
      this.finish();
    }
  }

  /**
   * Until every request received has its answer, or `TOOL_CALL_MS` passed
   * (a tool's call can take that long; past it, the client is gone anyway).
   */
  private answered(): Promise<void> {
    if (this.pending.size === 0 || this.stop.signal.aborted) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, TOOL_CALL_MS);
      this.drained = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  /** One line: a message to the server, or an error for one that is not. */
  private receive(line: string): void {
    let message: JSONRPCMessage;
    try {
      message = deserializeMessage(line);
    } catch (error) {
      this.onerror?.(asError(error));
      return;
    }
    if (isJSONRPCRequest(message)) this.pending.add(message.id);
    this.onmessage?.(message);
  }
}
