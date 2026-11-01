/**
 * Exemplo 5 do curso de input: num terminal de verdade (TTY). O que o input
 * faz além de ler vem das opções: onde escrever o eco, o Ctrl+C, os atalhos
 * e as linhas urgentes. Rode no terminal e digite:
 *
 *   bun agents/meus-testes/input-exemplos/5-terminal.ts
 *
 *   1. "q" numa linha vazia: responde na hora, sem Enter (`instant`);
 *   2. "oi" e Enter;
 *   3. Ctrl+O: um atalho, que vira a linha ":menu";
 *   4. "s" para a escolha.
 */
import { StdinReader } from '../../../src/input/index';
import { writeOut } from '../../../src/output/terminal';

const input = new StdinReader({
  // Sem `write`, o terminal em modo raw não mostraria o que se digita.
  write: writeOut,
  onInterrupt: () => {
    writeOut('\n(Ctrl+C)\n');
  },
  shortcuts: { '\u000f': ':menu' }, // Ctrl+O
  urgent: (line) => line.startsWith(':'),
});

const say = (text: string): void => {
  writeOut(`\n[programa] ${text}\n`);
};

say('digite q (sem Enter):');
say(`recebeu ${JSON.stringify(await input.next(undefined, ['q']))}`);
say('digite oi e Enter:');
say(`recebeu ${JSON.stringify(await input.next())}`);
say('aperte Ctrl+O:');
say(`recebeu ${JSON.stringify(await input.next())}`);
say('s ou n?');
say(`recebeu ${JSON.stringify(await input.choose(['s', 'n']))}`);
input.close();
