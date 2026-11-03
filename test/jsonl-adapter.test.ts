import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import { JsonlAdapter } from '../src/adapters/jsonl/index';
import { UsageError } from '../src/errors';
import { Conversation } from '../src/interaction/index';

const dirs: string[] = [];

/** A new conversation file, empty. */
function conversationFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-jsonl-'));
  dirs.push(dir);
  return join(dir, 'conversa.jsonl');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function lines(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}

function tick(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('JsonlAdapter', () => {
  test('cada linha que entra é um evento; o que sai vira uma linha', async () => {
    const path = conversationFile();
    const adapter = new JsonlAdapter({ path, pollMs: 5 });
    const conversation = new Conversation(adapter);

    conversation.write('Oi! Em que posso ajudar?');
    const asked = conversation.ask('');
    appendFileSync(path, '{"type":"message","text":"me ajude"}\n');

    expect(await asked).toBe('me ajude');
    conversation.stream('Claro, ');
    conversation.stream('vamos lá.');
    conversation.reasoning('pensando');
    // Closing ends the reasoning still streaming, which then goes out.
    conversation.close();
    await tick();

    expect(lines(path)).toEqual([
      { out: 'message', text: 'Oi! Em que posso ajudar?' },
      { type: 'message', text: 'me ajude' },
      { out: 'message', text: 'Claro, vamos lá.' },
      { out: 'reasoning', text: 'pensando' },
    ]);
  });

  test('não pede nada, e o comando chega como :nome', async () => {
    const path = conversationFile();
    const adapter = new JsonlAdapter({ path, pollMs: 5 });
    const conversation = new Conversation(adapter);

    expect(adapter.request()).toBeUndefined();
    appendFileSync(
      path,
      '{"type":"message","text":"um"}\n{"type":"command","name":"approvals"}\n',
    );
    const first = await conversation.listen();
    await tick();

    expect(first).toBe('um');
    expect(await conversation.listen()).toBe(':approvals');
    conversation.close();
  });

  test('startEmpty começa a conversa do zero', () => {
    const path = conversationFile();
    appendFileSync(path, '{"type":"message","text":"velha"}\n');
    new JsonlAdapter({ path, startEmpty: true }).close();

    expect(readFileSync(path, 'utf8')).toBe('');
  });

  test('uma linha que não é evento é recusada', async () => {
    const path = conversationFile();
    appendFileSync(path, '{"type":"mensagem","texto":"oi"}\n');
    const conversation = new Conversation(
      new JsonlAdapter({ path, pollMs: 5 }),
    );

    let error: unknown;
    try {
      await conversation.listen();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UsageError);
  });

  test('uma linha acima de maxRecordBytes é um erro', async () => {
    const path = conversationFile();
    appendFileSync(path, '{"type":"message","text":"longa demais"}\n');
    const conversation = new Conversation(
      new JsonlAdapter({ path, pollMs: 5, maxRecordBytes: 10 }),
    );

    let error: unknown;
    try {
      await conversation.listen();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UsageError);
  });
});
