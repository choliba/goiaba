import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, test } from 'bun:test';

import { NetworkGate, NetworkProxy } from '../src/network/index';
import { RequestRewriteStream } from '../src/network/rewrite';
import type { RewriteRequest } from '../src/network/types';

/** Replaces `a` with `b` in every body to `/x`. */
const swap: RewriteRequest = ({ path, body }) =>
  path === '/x'
    ? Buffer.from(Buffer.from(body).toString().replaceAll('a', 'bb'))
    : undefined;

/** What the stream sends on for `chunks`, fed one by one. */
async function through(
  chunks: readonly string[],
  rewrite: RewriteRequest = swap,
  maxBodyBytes = 1024,
): Promise<string> {
  const stream = new RequestRewriteStream(rewrite, maxBodyBytes);
  const out = new PassThrough();
  stream.pipe(out);
  for (const chunk of chunks) stream.write(Buffer.from(chunk));
  stream.end();
  let text = '';
  for await (const chunk of out) text += Buffer.from(chunk).toString();
  return text;
}

describe('RequestRewriteStream', () => {
  test('troca o corpo e o content-length, mesmo chegando aos pedaços', async () => {
    expect(
      await through([
        'POST /x HTTP/1.1\r\nHost: h\r\nContent-Le',
        'ngth: 3\r\n\r\naa',
        'a',
      ]),
    ).toBe('POST /x HTTP/1.1\r\nHost: h\r\nContent-Length: 6\r\n\r\nbbbbbb');
  });

  test('lê um corpo chunked e manda com content-length', async () => {
    expect(
      await through([
        'POST /x HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n2\r\naa\r\n1\r\na\r\n0\r\n\r\n',
      ]),
    ).toBe('POST /x HTTP/1.1\r\nContent-Length: 6\r\n\r\nbbbbbb');
  });

  test('vários pedidos na mesma conexão; o que não muda vai como veio', async () => {
    const other = 'GET /y HTTP/1.1\r\nHost: h\r\n\r\n';
    expect(
      await through([`${other}POST /x HTTP/1.1\r\nContent-Length: 1\r\n\r\na`]),
    ).toBe(`${other}POST /x HTTP/1.1\r\nContent-Length: 2\r\n\r\nbb`);
  });

  test('um corpo grande demais passa intacto, com o resto da conexão', async () => {
    const big = `POST /x HTTP/1.1\r\nContent-Length: 5\r\n\r\naaaaa`;
    expect(await through([big, 'resto'], swap, 4)).toBe(`${big}resto`);
  });

  test('um rewriter que falha deixa o pedido como veio', async () => {
    const original = 'POST /x HTTP/1.1\r\nContent-Length: 1\r\n\r\na';
    expect(
      await through([original], () => {
        throw new Error('quebrou');
      }),
    ).toBe(original);
  });
});

test('o proxy reescreve os pedidos de um túnel ao destino do rewriter', async () => {
  const received: string[] = [];
  const destination = createServer((incoming, response) => {
    let body = '';
    incoming.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    incoming.on('end', () => {
      received.push(body);
      response.end('ok');
    });
  });
  await new Promise<void>((resolve) =>
    destination.listen(0, '127.0.0.1', resolve),
  );
  const address = destination.address();
  if (address === null || typeof address === 'string') {
    throw new Error('o servidor de teste não abriu uma porta');
  }
  const { port } = address;
  const proxy = new NetworkProxy(
    new NetworkGate({
      rules: { default: 'allow', allow: [], requireApproval: [], deny: [] },
      approve: () => Promise.reject(new Error('não deveria perguntar')),
    }),
    [],
    undefined,
    [{ destination: `127.0.0.1:${String(port)}`, rewrite: swap }],
  );
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-rewrite-'));
  const socketPath = join(dir, 'proxy.sock');
  await proxy.start(socketPath);

  try {
    // A tunnel, as the bridge opens it, and an HTTP request through it.
    const tunnel = connect(socketPath);
    await new Promise<void>((resolve) => {
      tunnel.once('data', () => resolve());
      tunnel.write(
        `CONNECT 127.0.0.1:${String(port)} HTTP/1.1\r\nHost: 127.0.0.1:${String(port)}\r\n\r\n`,
      );
    });
    const answer = await new Promise<string>((resolve, reject) => {
      const sent = request(
        {
          path: '/x',
          method: 'POST',
          headers: { host: `127.0.0.1:${String(port)}` },
          createConnection: () => tunnel,
        },
        (response) => {
          let text = '';
          response.on('data', (chunk: Buffer) => {
            text += chunk.toString();
          });
          response.on('end', () => resolve(text));
        },
      );
      sent.on('error', reject);
      sent.end('aaa');
    });

    expect(answer).toBe('ok');
    expect(received).toEqual(['bbbbbb']);
  } finally {
    await proxy.close();
    destination.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
