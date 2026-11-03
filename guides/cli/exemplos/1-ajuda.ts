/**
 * Exemplo 1 do curso de cli: o comando `approvals` e a ajuda dele. O
 * exemplo roda o comando como um programa, pelo Executor, e mostra a saída.
 *
 *   bun guides/cli/exemplos/1-ajuda.ts
 */
import { Executor } from '../../../src/execute/index';
import { runtimeExecutable } from '../../../src/execute/process';
import { stdioOutput } from '../../../src/output/index';

const approvals = new URL('../../../src/cli/approvals.ts', import.meta.url)
  .pathname;

for await (const { chunk } of new Executor().run({
  executable: runtimeExecutable(),
  arguments: [approvals, '--help'],
})) {
  await stdioOutput.write(chunk.trimEnd());
}
