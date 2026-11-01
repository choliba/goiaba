import { mkdtempSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

import { NetworkGate, NetworkProxy, type Traffic } from '../src/network/index';

test('o observador recebe os dois lados de um túnel, sem mudar a conexão', async () => {
  const destination = createServer((socket) => {
    socket.on('data', () => socket.end('pong'));
  });
  await new Promise<void>((resolve) =>
    destination.listen(0, '127.0.0.1', resolve),
  );
  const address = destination.address();
  if (address === null || typeof address === 'string') {
    throw new Error('o servidor de teste não abriu uma porta');
  }
  const { port } = address;

  const observed: Traffic[] = [];
  const proxy = new NetworkProxy(
    new NetworkGate({
      rules: { default: 'allow', allow: [], requireApproval: [], deny: [] },
      approve: () => Promise.reject(new Error('não deveria perguntar')),
    }),
    [
      {
        destination: `127.0.0.1:${String(port)}`,
        observe: (traffic) => observed.push(traffic),
      },
    ],
  );
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-observe-'));
  const socketPath = join(dir, 'proxy.sock');
  await proxy.start(socketPath);

  try {
    const received = await new Promise<string>((resolve) => {
      const client = connect(socketPath);
      let text = '';
      client.on('data', (chunk) => {
        text += chunk.toString();
        if (text.includes('\r\n\r\n') && !text.includes('ping-sent')) {
          text += 'ping-sent';
          client.write('ping');
        }
      });
      client.on('close', () => resolve(text));
      client.write(
        `CONNECT 127.0.0.1:${String(port)} HTTP/1.1\r\nHost: 127.0.0.1:${String(port)}\r\n\r\n`,
      );
    });

    expect(received).toEndWith('pong');
    expect(observed).toHaveLength(1);
    const traffic = observed.at(0);
    expect(await textOf(traffic?.requests)).toBe('ping');
    expect(await textOf(traffic?.responses)).toBe('pong');
  } finally {
    await proxy.close();
    destination.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function textOf(
  bytes: AsyncIterable<Uint8Array> | undefined,
): Promise<string> {
  let result = '';
  for await (const chunk of bytes ?? [])
    result += Buffer.from(chunk).toString();
  return result;
}
