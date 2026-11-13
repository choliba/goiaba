/**
 * Exemplo 2 do curso de mcp: ferramentas de tipos diferentes, chamadas pelo
 * broker como o modelo as chamaria. Uma de texto, uma de número com uma
 * lista de opções, e uma que falha. Antes de `run`, o broker confere a
 * entrada pelo schema; o que não cabe volta ao modelo como erro, com o
 * motivo, para ele tentar de novo.
 */
import { ToolBroker, tool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';

/** Texto: conta as palavras de um texto. */
const contarPalavras = tool({
  name: 'contar_palavras',
  description: 'Conta as palavras de um texto.',
  input: {
    type: 'object',
    properties: { texto: { type: 'string' } },
    required: ['texto'],
    additionalProperties: false,
  },
  run: (input: { readonly texto: string }) =>
    `${String(input.texto.trim().split(/\s+/).length)} palavras.`,
});

/** Número com opções: converte uma temperatura e devolve um objeto. */
const converterTemperatura = tool({
  name: 'converter_temperatura',
  description: 'Converte uma temperatura entre Celsius e Fahrenheit.',
  input: {
    type: 'object',
    properties: {
      valor: { type: 'number' },
      para: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    },
    required: ['valor', 'para'],
    additionalProperties: false,
  },
  run: (input: { readonly valor: number; readonly para: string }) =>
    input.para === 'fahrenheit'
      ? { fahrenheit: (input.valor * 9) / 5 + 32 }
      : { celsius: ((input.valor - 32) * 5) / 9 },
});

/** Uma que falha: o erro de `run` vira a resposta, marcada como erro. */
const dividir = tool({
  name: 'dividir',
  description: 'Divide a por b.',
  input: {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'number' } },
    required: ['a', 'b'],
  },
  run: (input: { readonly a: number; readonly b: number }) => {
    if (input.b === 0) throw new Error('Não dá para dividir por zero.');
    return input.a / input.b;
  },
});

// Sem política: toda ferramenta declarada pode ser chamada.
const broker = new ToolBroker({
  tools: [contarPalavras, converterTemperatura, dividir],
  policy: undefined,
});

const calls: [string, unknown][] = [
  ['contar_palavras', { texto: 'goiaba com queijo é romeu e julieta' }],
  ['converter_temperatura', { valor: 30, para: 'fahrenheit' }],
  ['dividir', { a: 10, b: 4 }],
  ['dividir', { a: 1, b: 0 }],
  // O que o broker recusa antes de rodar:
  ['converter_temperatura', { valor: 30 }],
  ['converter_temperatura', { valor: '30', para: 'celsius' }],
  ['converter_temperatura', { valor: 30, para: 'kelvin' }],
  ['contar_palavras', { texto: 'oi', idioma: 'pt' }],
  ['traduzir', { texto: 'oi' }],
];

for (const [name, input] of calls) {
  const { text, isError } = await broker.call(name, input);
  writeOut(
    `${name} ${JSON.stringify(input)}\n  ${isError ? 'erro' : 'ok'}: ${text}\n`,
  );
}

// O broker guarda o servidor e o socket numa pasta do cache: close a apaga.
await broker.close();
