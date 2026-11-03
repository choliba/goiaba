import { describe, expect, test } from 'bun:test';

import type { StdioSource } from '../src/adapters/stdio/index';
import {
  TuiAdapter,
  displayWidth,
  frame,
  wrap,
  type TuiScreen,
} from '../src/adapters/tui/index';
import { OutputStream } from '../src/execute/stream';
import { Conversation } from '../src/interaction/index';

describe('layout', () => {
  test('quebra por palavras e corta a palavra maior que a linha', () => {
    expect(wrap('o mar azul sob o céu', 10)).toEqual([
      'o mar azul',
      'sob o céu',
    ]);
    expect(wrap('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
    expect(wrap('linha um\nlinha dois', 20)).toEqual([
      'linha um',
      'linha dois',
    ]);
  });

  test('emoji e caracteres largos ocupam duas colunas; acentos, uma', () => {
    expect(displayWidth('💭 oi')).toBe(5);
    expect(displayWidth('漢字')).toBe(4);
    expect(displayWidth('ação')).toBe(4);
  });

  test('mostra as últimas mensagens que cabem, o status e a entrada', () => {
    const { lines } = frame(
      [
        { kind: 'text', text: 'primeira', open: false },
        { kind: 'user', text: 'oi', open: false },
        { kind: 'text', text: 'resposta', open: false },
      ],
      {
        rows: 5,
        columns: 20,
        status: '⏳ pensando…',
        input: 'digit',
        showReasoning: true,
      },
    );

    expect(lines).toEqual([
      '› oi',
      '',
      'resposta',
      '⏳ pensando…   /help',
      '› digit',
    ]);
  });
});

describe('TuiAdapter', () => {
  test('junta os pedaços do stream e separa raciocínio de resposta', async () => {
    const { tui, screen, type } = setup();
    const asked = tui.ask('');
    type('primeira\r');
    await asked;

    tui.reasoning('pen');
    tui.reasoning('sei');
    tui.stream('Olá, ');
    tui.stream('mundo');
    await tick();

    expect(screen.lines()).toEqual(
      expect.arrayContaining(['› primeira', '💭 pensei', 'Olá, mundo']),
    );
  });

  test('/thinking esconde o raciocínio; os comandos não vão ao agente', async () => {
    const { tui, screen, type } = setup();
    tui.reasoning('pensei muito');
    const asked = tui.ask('');
    type('/thinking\r');
    type('segunda\r');

    expect(await asked).toBe('segunda');
    await tick();
    expect(screen.lines()).toEqual(
      expect.arrayContaining([
        'Raciocínio escondido.',
        '💭 pensou (/thinking mostra)',
        '› segunda',
      ]),
    );
    expect(screen.lines()).not.toContain('› /thinking');
  });

  test('um comando desconhecido é recusado, com a ajuda', async () => {
    const { tui, screen, type } = setup();
    const asked = tui.ask('');
    type('/xyz\r');
    type('ok\r');
    await asked;
    await tick();

    expect(screen.lines()).toContain('Comando desconhecido: /xyz. Veja /help.');
  });

  test('o que se digita aparece na linha de entrada, com o apagar', async () => {
    const { tui, screen, type } = setup();
    void tui.ask('').catch(() => undefined);
    type('olx');
    type('\u007f');
    type('á');
    await tick();

    expect(screen.lines().at(-1)).toBe('› olá');
    tui.close();
  });

  test('↑ e PageUp rolam para trás, End volta ao fim', async () => {
    const { tui, screen, type } = setup();
    void tui.ask('').catch(() => undefined);
    for (let line = 1; line <= 12; line += 1) {
      tui.write(`linha ${String(line)}`);
    }
    await tick();
    expect(screen.lines()).toContain('linha 12');

    type('\u001b[5~');
    await tick();
    expect(screen.lines()).not.toContain('linha 12');
    expect(screen.lines().at(-2)).toMatch(/^↓ \d+ linha\(s\) abaixo/);

    type('\u001b[F');
    await tick();
    expect(screen.lines()).toContain('linha 12');
    tui.close();
  });

  test('a escolha aparece como resposta de quem usa', async () => {
    const { tui, screen, type } = setup();
    const chosen = tui.choose(['s', 'n']);
    type('S');

    expect(await chosen).toBe('s');
    await tick();
    expect(screen.lines()).toContain('› s');
    tui.close();
  });

  test('/exit interrompe a conversa', async () => {
    const { tui, type } = setup();
    let interrupted = false;
    const conversation = new Conversation(
      new TuiAdapter({
        screen: new FakeScreen(),
        source: tui.source,
        frameDelayMs: 0,
      }),
      {
        onInterrupt: () => {
          interrupted = true;
        },
      },
    );
    const asked = conversation.ask('').catch(() => undefined);
    type('/exit\r');
    await asked;

    expect(interrupted).toBe(true);
  });

  test('ao fechar, sai da tela e deixa a conversa no terminal', async () => {
    const { tui, screen, type } = setup();
    const asked = tui.ask('');
    type('primeira\r');
    await asked;
    tui.write('resposta');
    await tick();
    tui.close();

    expect(screen.left).toEqual(['› primeira\n\nresposta']);
    expect(screen.entered).toBe(1);
  });
});

/** A TUI conversation on a fake 8×40 screen; `type` sends keys. */
function setup(): {
  tui: Conversation & { readonly source: StdioSource };
  screen: FakeScreen;
  type: (keys: string) => void;
} {
  const screen = new FakeScreen();
  const keys = new OutputStream<string>();
  const source: StdioSource = { tty: true, read: () => keys };
  const tui = Object.assign(
    new Conversation(new TuiAdapter({ screen, source, frameDelayMs: 0 }), {
      onInterrupt: () => undefined,
    }),
    { source },
  );
  return {
    tui,
    screen,
    type: (text) => {
      keys.publish(text);
    },
  };
}

class FakeScreen implements TuiScreen {
  public entered = 0;
  public readonly left: string[] = [];
  private last = '';

  public readonly rows = (): number => 8;
  public readonly columns = (): number => 40;

  public enter(): void {
    this.entered += 1;
  }

  public leave(text: string): void {
    this.left.push(text);
  }

  public draw(text: string): void {
    this.last = text;
  }

  /** The last frame's lines, without styles. */
  public lines(): string[] {
    return (
      this.last
        // oxlint-disable-next-line no-control-regex -- ESC starts every sequence.
        .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
        .split('\r\n')
        .map((line) => line.trimEnd())
    );
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
