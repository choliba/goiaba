/**
 * Exemplo 4 do curso de mcp: ler e escrever arquivos. Duas ferramentas
 * sobre uma pasta de notas: `ler_nota` (lê uma, ou lista todas) e
 * `salvar_nota` (escreve, sem sobrescrever a não ser que peçam). `run`
 * roda no processo do Goiaba, fora da sandbox do agente: quem limita onde
 * elas leem e escrevem são elas mesmas. Por isso, só nomes de arquivo,
 * nunca um caminho com pasta ou `..`.
 */
import { randomUUID } from 'node:crypto';

import { environment } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  listDirectory,
  pathExists,
  readText,
  removePath,
  writeText,
} from '../../../src/filesystem/index';
import { ToolBroker, tool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';

// Uma pasta de notas de mentira, apagada no fim.
const notas = join(goiabaCacheDir(environment()), 'mcp-exemplo', randomUUID());
ensureDirectory(notas);
writeText(join(notas, 'compras.md'), 'goiaba\nqueijo minas\n');

/** O arquivo de uma nota; um erro (que o modelo lê) para um nome com pasta. */
function arquivoDe(nome: string): string {
  if (nome.includes('/') || nome.includes('\\') || nome.includes('..')) {
    throw new Error('Diga só o nome da nota, como compras.md, sem pastas.');
  }
  return join(notas, nome);
}

const lerNota = tool({
  name: 'ler_nota',
  description:
    'Lê uma nota pelo nome (como compras.md) e devolve o texto. Sem nome, lista as notas.',
  input: {
    type: 'object',
    properties: { nome: { type: 'string', description: 'O nome da nota.' } },
    additionalProperties: false,
  },
  run: (input: { readonly nome?: string }) => {
    if (input.nome === undefined) {
      return { notas: listDirectory(notas).toSorted() };
    }
    const arquivo = arquivoDe(input.nome);
    if (!pathExists(arquivo)) throw new Error(`Não há a nota ${input.nome}.`);
    return { nome: input.nome, texto: readText(arquivo) };
  },
});

const salvarNota = tool({
  name: 'salvar_nota',
  description:
    'Escreve uma nota. Uma nota que já existe só é trocada com substituir: true.',
  input: {
    type: 'object',
    properties: {
      nome: { type: 'string', description: 'O nome da nota, como ideias.md.' },
      texto: { type: 'string', description: 'O conteúdo inteiro da nota.' },
      substituir: { type: 'boolean' },
    },
    required: ['nome', 'texto'],
    additionalProperties: false,
  },
  run: (input: {
    readonly nome: string;
    readonly texto: string;
    readonly substituir?: boolean;
  }) => {
    const arquivo = arquivoDe(input.nome);
    if (pathExists(arquivo) && input.substituir !== true) {
      throw new Error(
        `A nota ${input.nome} já existe: peça substituir: true para trocá-la.`,
      );
    }
    writeText(arquivo, input.texto);
    return `Nota ${input.nome} salva (${String(input.texto.length)} caracteres).`;
  },
});

const broker = new ToolBroker({
  tools: [lerNota, salvarNota],
  policy: undefined,
});

const calls: [string, unknown][] = [
  ['ler_nota', {}],
  ['ler_nota', { nome: 'compras.md' }],
  ['salvar_nota', { nome: 'ideias.md', texto: 'doce de goiaba com café\n' }],
  ['salvar_nota', { nome: 'compras.md', texto: 'só café\n' }],
  [
    'salvar_nota',
    { nome: 'compras.md', texto: 'goiaba\ncafé\n', substituir: true },
  ],
  ['salvar_nota', { nome: '../fora.md', texto: 'x' }],
  ['ler_nota', {}],
  ['ler_nota', { nome: 'compras.md' }],
];

try {
  for (const [name, input] of calls) {
    const { text, isError } = await broker.call(name, input);
    writeOut(
      `${name} ${JSON.stringify(input)}\n  ${isError ? 'erro' : 'ok'}: ${text}\n`,
    );
  }
} finally {
  await broker.close();
  removePath(notas);
}
