/**
 * Changes the bodies of the HTTP/1.1 requests on a connection as they pass
 * (a plain-HTTP tunnel to a local model): each request is read whole, its
 * body handed to the rewriter, and sent on with the new body and its new
 * length. Anything it cannot read for sure (another framing, `Expect`, an
 * upgrade, a body too large) makes it pass the rest of the connection on
 * untouched: a request is never broken to be changed.
 */

import { Transform, type TransformCallback } from 'node:stream';

import { log } from '../logger/index';
import { MAX_REQUEST_HEAD_BYTES } from './constants';
import type { RewriteRequest } from './types';

const HEAD_END = '\r\n\r\n';
const LINE_END = '\r\n';

type Chunked =
  { readonly body: Buffer; readonly end: number } | 'wait' | 'invalid';

/** A chunked body from `start`: whole, not yet, or not readable. */
function decodeChunked(
  buffer: Buffer,
  start: number,
  maxBodyBytes: number,
): Chunked {
  const parts: Buffer[] = [];
  let total = 0;
  let position = start;
  for (;;) {
    const lineEnd = buffer.indexOf(LINE_END, position);
    if (lineEnd === -1) return 'wait';
    const sizeText = buffer
      .subarray(position, lineEnd)
      .toString('latin1')
      .split(';', 1)
      .join('')
      .trim();
    const size = Number.parseInt(sizeText, 16);
    if (Number.isNaN(size) || size < 0) return 'invalid';
    position = lineEnd + LINE_END.length;
    if (size === 0) {
      // Trailers, if any, end with an empty line.
      if (buffer.length < position + LINE_END.length) return 'wait';
      if (buffer.subarray(position, position + 2).toString() === LINE_END) {
        return { body: Buffer.concat(parts), end: position + 2 };
      }
      const trailersEnd = buffer.indexOf(HEAD_END, position);
      if (trailersEnd === -1) return 'wait';
      return { body: Buffer.concat(parts), end: trailersEnd + HEAD_END.length };
    }
    total += size;
    if (total > maxBodyBytes) return 'invalid';
    if (buffer.length < position + size + LINE_END.length) return 'wait';
    parts.push(buffer.subarray(position, position + size));
    position += size + LINE_END.length;
  }
}

export class RequestRewriteStream extends Transform {
  private pending = Buffer.alloc(0);
  private passing = false;

  public constructor(
    private readonly rewrite: RewriteRequest,
    private readonly maxBodyBytes: number,
  ) {
    super();
  }

  public override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: TransformCallback,
  ): void {
    if (this.passing) {
      done(null, chunk);
      return;
    }
    this.pending = Buffer.concat([this.pending, chunk]);
    this.drain();
    done();
  }

  public override _flush(done: TransformCallback): void {
    if (this.pending.length > 0) this.push(this.pending);
    this.pending = Buffer.alloc(0);
    done();
  }

  /** From here on, the bytes as they come; what is held goes first. */
  private passOn(reason: string): void {
    log.debug({ type: 'network_rewrite_skipped', reason });
    this.passing = true;
    if (this.pending.length > 0) this.push(this.pending);
    this.pending = Buffer.alloc(0);
  }

  /** Sends on every whole request held; keeps what is not whole yet. */
  private drain(): void {
    for (;;) {
      const headEnd = this.pending.indexOf(HEAD_END);
      if (headEnd === -1) {
        if (this.pending.length > MAX_REQUEST_HEAD_BYTES) {
          this.passOn('cabeçalho grande demais');
        }
        return;
      }
      const [requestLine = '', ...headerLines] = this.pending
        .subarray(0, headEnd)
        .toString('latin1')
        .split(LINE_END);
      // `METHOD path HTTP/1.1`.
      const words = requestLine.split(' ');
      const method = words.at(0) ?? '';
      const path = words.at(1) ?? '';
      if (words.length !== 3 || method === '' || path === '') {
        this.passOn('linha de pedido ilegível');
        return;
      }
      const header = (name: string): string | undefined =>
        headerLines
          .find((line) => line.toLowerCase().startsWith(`${name}:`))
          ?.slice(name.length + 1)
          .trim();
      if (header('expect') !== undefined || header('upgrade') !== undefined) {
        this.passOn('pedido com expect ou upgrade');
        return;
      }
      const bodyStart = headEnd + HEAD_END.length;
      const encoding = header('transfer-encoding');
      let body: Buffer;
      let end: number;
      if (encoding === undefined) {
        const length = Number(header('content-length') ?? '0');
        if (!Number.isInteger(length) || length < 0) {
          this.passOn('content-length inválido');
          return;
        }
        if (length > this.maxBodyBytes) {
          this.passOn('corpo grande demais');
          return;
        }
        if (this.pending.length < bodyStart + length) return;
        body = this.pending.subarray(bodyStart, bodyStart + length);
        end = bodyStart + length;
      } else {
        if (encoding.toLowerCase() !== 'chunked') {
          this.passOn(`transfer-encoding ${encoding}`);
          return;
        }
        const chunked = decodeChunked(
          this.pending,
          bodyStart,
          this.maxBodyBytes,
        );
        if (chunked === 'wait') return;
        if (chunked === 'invalid') {
          this.passOn('corpo chunked ilegível ou grande demais');
          return;
        }
        ({ body, end } = chunked);
      }

      const original = this.pending.subarray(0, end);
      this.pending = this.pending.subarray(end);
      let rewritten: Uint8Array | undefined;
      try {
        rewritten = this.rewrite({ method, path, body });
      } catch (error) {
        log.debug({
          type: 'network_rewrite_failure',
          message: error instanceof Error ? error.message : String(error),
        });
        rewritten = undefined;
      }
      if (rewritten === undefined) {
        this.push(original);
        continue;
      }
      const kept = headerLines.filter(
        (line) => !/^(content-length|transfer-encoding)\s*:/i.test(line),
      );
      const head = [
        requestLine,
        ...kept,
        `Content-Length: ${String(rewritten.length)}`,
      ].join(LINE_END);
      this.push(
        Buffer.concat([Buffer.from(`${head}${HEAD_END}`, 'latin1'), rewritten]),
      );
    }
  }
}
