import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { records } from '../src/adapters/stdio/records';
import { LineEditor } from '../src/adapters/stdio/line';
import { UsageError } from '../src/errors';

const SUPPORT = join(import.meta.dir, 'support');

/** Runs a support script with `stdin`, or with stdin left open when `null`. */
function run(
  script: string,
  args: string[],
  stdin: string | null,
): Promise<{ code: number | null; signal: string | null; stdout: string }> {
  const child = spawn(process.execPath, [join(SUPPORT, script), ...args], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
    if (script === 'program-exit.ts' && stdout.includes('pronto')) {
      child.kill('SIGTERM');
    }
  });
  if (stdin !== null) child.stdin.end(stdin);
  return new Promise((resolve) => {
    child.once('close', (code, signal) => {
      resolve({ code, signal, stdout });
    });
  });
}

function lastLine(stdout: string): unknown {
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? 'null');
}

describe('src/input: a fonte do stdin', () => {
  test('read devolve tudo, até o fim', async () => {
    const { stdout } = await run('stdin-source.ts', ['read'], 'olá\nmundo');
    expect(lastLine(stdout)).toEqual({ text: 'olá\nmundo' });
  });

  test('readStream entrega os pedaços até o fim', async () => {
    const { stdout } = await run('stdin-source.ts', ['stream'], 'a\nb\nc');
    expect(lastLine(stdout)).toEqual({ text: 'a\nb\nc' });
  });

  test('dois leitores ao mesmo tempo: o segundo é recusado', async () => {
    const { stdout } = await run('stdin-source.ts', ['twice'], 'x');
    expect(lastLine(stdout)).toEqual({ error: UsageError.name });
  });

  test('depois do fim, ler de novo termina na hora', async () => {
    const { stdout } = await run('stdin-source.ts', ['after-end'], 'x');
    expect(lastLine(stdout)).toEqual({ done: true });
  });

  test('criar o stream não abre o stdin: só ler abre', async () => {
    const { code, stdout } = await run('stdin-source.ts', ['lazy'], null);
    expect(code).toBe(0);
    expect(lastLine(stdout)).toEqual({ opened: false });
  });

  test('o signal encerra o stream com AbortError', async () => {
    const { stdout } = await run('stdin-source.ts', ['abort'], null);
    expect(lastLine(stdout)).toEqual({ error: 'AbortError' });
  });
});

describe('onProgramExit', () => {
  test('roda no exitProgram; o desinscrito não roda', async () => {
    const { code, stdout } = await run('program-exit.ts', ['exit'], '');
    expect(code).toBe(3);
    expect(stdout).toBe('limpou\n');
  });

  test('roda quando o programa termina sozinho', async () => {
    const { code, stdout } = await run('program-exit.ts', ['end'], '');
    expect(code).toBe(0);
    expect(stdout).toBe('limpou\n');
  });

  test('roda num SIGTERM, e o sinal ainda encerra o programa', async () => {
    const { signal, stdout } = await run('program-exit.ts', ['signal'], '');
    expect(signal).toBe('SIGTERM');
    expect(stdout).toBe('pronto\nlimpou\n');
  });
});

async function* from(pieces: string[]): AsyncGenerator<string> {
  for (const piece of pieces) yield piece;
}

async function collect(pieces: string[], max?: number): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of records(from(pieces), max)) lines.push(line);
  return lines;
}

describe('records: linhas de um stream', () => {
  test('junta pedaços até a quebra; um pedaço pode fechar várias linhas', async () => {
    expect(await collect(['{"a":', '1}\n{"b"', ':2}\nfim'])).toEqual([
      '{"a":1}',
      '{"b":2}',
      'fim',
    ]);
    expect(await collect(['um\r\ndois\r\n'])).toEqual(['um', 'dois']);
  });

  test('uma linha acima do limite é um erro, nunca cortada', async () => {
    let error: unknown;
    try {
      await collect(['abc', 'def'], 4);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UsageError);
    expect(await collect(['abcd\nefgh'], 4)).toEqual(['abcd', 'efgh']);
  });
});

describe('LineEditor', () => {
  test('apaga o último caractere visto, e entregar recomeça a linha', () => {
    const line = new LineEditor();
    line.insert('olá 👍');
    expect(line.erase()).toBe(true);
    expect(line.text).toBe('olá ');
    expect(line.take()).toBe('olá ');
    expect(line.text).toBe('');
    expect(line.erase()).toBe(false);
  });
});
