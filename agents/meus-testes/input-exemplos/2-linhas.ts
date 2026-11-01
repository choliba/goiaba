/**
 * Exemplo 2 do curso de input: linha a linha, sem terminal. Este arquivo é
 * dois programas:
 *
 * - sem argumentos, ele inicia a si mesmo como `leitor`, pelo Executor, e
 *   manda as linhas pelo stdin do leitor;
 * - como `leitor`, o stdin dele é um pipe, não um teclado: `next` devolve a
 *   próxima linha e `choose` a primeira letra dela, em minúscula.
 *
 *   bun agents/meus-testes/input-exemplos/2-linhas.ts
 */
import { Executor } from '../../../src/execute/index';
import {
  programArguments,
  runtimeExecutable,
} from '../../../src/execute/process';
import { StdinReader } from '../../../src/input/index';
import { writeOut } from '../../../src/output/terminal';

if (programArguments()[0] === 'leitor') {
  const input = new StdinReader();

  writeOut(`next: ${JSON.stringify(await input.next())}\n`);
  writeOut(`next: ${JSON.stringify(await input.next())}\n`);
  writeOut(
    `choose(['s', 'n']): ${JSON.stringify(await input.choose(['s', 'n']))}\n`,
  );

  try {
    await input.next();
  } catch (error) {
    // O stdin acabou: não há mais linhas.
    const message = error instanceof Error ? error.message : String(error);
    writeOut(`next depois do fim: ${message}\n`);
  }
  input.close();
} else {
  // O mesmo arquivo, como leitor, com três linhas no stdin.
  for await (const { chunk } of new Executor().run({
    executable: runtimeExecutable(),
    arguments: [new URL(import.meta.url).pathname, 'leitor'],
    input: 'olá\ntudo bem\nSim\n',
  })) {
    writeOut(chunk);
  }
}
