import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

import {
  defineCommand,
  helpText,
  parseCommandLine,
  runCommand,
} from '../src/command/index';
import { clearConfigCache } from '../src/config/index';
import { UsageError } from '../src/errors';
import type { OutputAdapter } from '../src/output/index';

const issue = defineCommand({
  name: 'issue',
  description: 'Abre uma issue.',
  args: {
    arquivo: { description: 'Markdown', required: true },
    extra: { description: 'Opcional' },
  },
  options: {
    repo: {
      type: 'string',
      short: 'r',
      value: 'owner/nome',
      description: 'Repo',
    },
    label: { type: 'string', default: 'log', description: 'Label' },
    dry: { type: 'boolean', short: 'd', description: 'Só mostra' },
  },
  run: () => undefined,
});

afterEach(() => {
  clearConfigCache();
});

function parseError(argv: string[]): unknown {
  try {
    parseCommandLine(issue, argv);
    return undefined;
  } catch (thrown) {
    return thrown;
  }
}

/** An output that keeps what is written. */
function recorder(): { written: string[]; output: OutputAdapter } {
  const written: string[] = [];
  const output: OutputAdapter = {
    ask: () => Promise.resolve(''),
    write: (value) => written.push(value),
  };
  return { written, output };
}

describe('parseCommandLine', () => {
  test('lê argumentos, opções e padrões', () => {
    expect(parseCommandLine(issue, ['plano.md', '-r', 'a/b', '--dry'])).toEqual(
      {
        help: false,
        args: { arquivo: 'plano.md', extra: undefined },
        options: { repo: 'a/b', label: 'log', dry: true },
      },
    );
    expect(parseCommandLine(issue, ['plano.md', '--repo=a/b'])).toMatchObject({
      options: { repo: 'a/b', dry: false },
    });
  });

  test('--help e -h pedem a ajuda', () => {
    expect(parseCommandLine(issue, ['--help'])).toEqual({ help: true });
    expect(parseCommandLine(issue, ['plano.md', '-h'])).toEqual({ help: true });
  });

  test('erros de uso viram UsageError com o uso', () => {
    for (const [argv, message] of [
      [[], 'Falta o argumento <arquivo>.'],
      [['a', 'b', 'c'], 'Argumento a mais: c'],
      [['a', '--xpto'], 'Opção desconhecida: --xpto'],
      [['a', '--repo'], 'Falta o valor de -r, --repo.'],
    ] as const) {
      const thrown = parseError([...argv]);
      expect(thrown).toBeInstanceOf(UsageError);
      expect(String(thrown)).toContain(message);
      expect(String(thrown)).toContain(
        'Uso: bun issue <arquivo> [extra] [opções]',
      );
    }
  });
});

test('helpText descreve argumentos e opções', () => {
  expect(helpText(issue)).toBe(
    [
      'Uso: bun issue <arquivo> [extra] [opções]',
      '',
      'Abre uma issue.',
      '',
      'Argumentos:',
      '  <arquivo>  Markdown',
      '  [extra]    Opcional',
      '',
      'Opções:',
      '  -r, --repo <owner/nome>  Repo',
      '      --label <valor>      Label (padrão: log)',
      '  -d, --dry                Só mostra',
      '  -h, --help               Mostra esta ajuda',
    ].join('\n'),
  );
});

describe('runCommand', () => {
  test('--help escreve a ajuda e não roda o comando', async () => {
    const { written, output } = recorder();
    let ran = false;

    await runCommand(
      defineCommand({
        name: 'x',
        description: 'X.',
        run: () => {
          ran = true;
        },
      }),
      { argv: ['--help'], output, onFailure: () => undefined },
    );

    expect(ran).toBe(false);
    expect(written.join('\n')).toContain('Uso: bun x');
  });

  test('erro de uso é mostrado e encerra como falha, sem rodar', async () => {
    const { written, output } = recorder();
    let failures = 0;

    await runCommand(issue, {
      argv: [],
      output,
      onFailure: () => {
        failures += 1;
      },
    });

    expect(failures).toBe(1);
    expect(written.join('\n')).toContain('Falta o argumento <arquivo>.');
  });

  test('roda com os valores tipados', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'goiaba-command-'));
    const { output } = recorder();
    const seen: unknown[] = [];

    try {
      await runCommand(
        defineCommand({
          name: 'x',
          description: 'X.',
          args: { nome: { description: 'Nome', required: true } },
          options: { alto: { type: 'boolean', description: 'Alto' } },
          run: ({ args, options }) => {
            // Inferred from the declaration: string and boolean.
            const nome: string = args.nome;
            const alto: boolean = options.alto;
            seen.push(nome, alto);
          },
        }),
        { argv: ['ana', '--alto'], output, config: { cwd } },
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    expect(seen).toEqual(['ana', true]);
  });
});
