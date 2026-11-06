/**
 * Exemplo 5 do curso de rounds: as referências `arquivo:linha`. Do que o
 * agente disse, a rodada tira cada citação (`src/app.ts:12`,
 * `package.json:3-5`) e confere se o arquivo existia no ponto de partida e
 * se a linha está dentro dele. Aqui o "ponto de partida" é uma tabela
 * (arquivo → número de linhas), no lugar do git da rodada. Não roda agente
 * nenhum.
 */
import { writeOut } from '../../../src/output/stdio';
import {
  checkReferences,
  parseReferences,
} from '../../../src/rounds/references';

/** O que o agente respondeu. */
const said = [
  'O problema está em src/app.ts:12 e se repete em src/app.ts:40-44.',
  'A dependência fica em package.json:3-5; veja também src/util.ts:7.',
  'Repito: src/app.ts:12. A versão 1.2 não é referência.',
].join('\n');

/** Quantas linhas cada arquivo tinha no início da rodada. */
const linesAtStart: Readonly<Record<string, number>> = {
  'src/app.ts': 42,
  'package.json': 20,
};

writeOut('citadas:\n');
for (const reference of parseReferences(said)) {
  writeOut(
    `  ${reference.text} → ${reference.path}, linha ${String(reference.line)}\n`,
  );
}

const checked = await checkReferences(said, (path) =>
  Promise.resolve(linesAtStart[path]),
);
writeOut(
  `\ncitadas: ${String(checked.cited)} · existem: ${String(checked.valid)} · não existem: ${checked.invalid.join(', ')}\n`,
);
