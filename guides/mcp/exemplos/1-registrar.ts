/**
 * Exemplo 1 do curso de mcp: registrar uma ferramenta. `registerTool`
 * confere a declaração e devolve o nome com que ela é usada em todo lugar,
 * `goiaba/<nome>`: no `tools` do provider e na política. Uma declaração
 * errada é um UsageError que diz o que corrigir. Não roda nenhum agente.
 */
import { UsageError } from '../../../src/errors';
import { registerTool, type AgentTool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';

/** Uma calculadora: soma dois números. */
const somar: AgentTool = {
  name: 'somar',
  description: 'Soma dois números e devolve o resultado.',
  input: {
    type: 'object',
    properties: {
      a: { type: 'number', description: 'A primeira parcela.' },
      b: { type: 'number', description: 'A segunda parcela.' },
    },
    required: ['a', 'b'],
    additionalProperties: false,
  },
  run: (input: { readonly a: number; readonly b: number }) => input.a + input.b,
};

const key = registerTool(somar);
writeOut(`registrada: ${key}\n\n`);

/** Cada uma com um erro só, e a mensagem que ele dá. */
const wrong: [string, AgentTool][] = [
  ['nome com maiúsculas', { ...somar, name: 'Somar' }],
  ['sem descrição', { ...somar, name: 'somar_2', description: ' ' }],
  ['o mesmo nome de novo', somar],
];

for (const [label, definition] of wrong) {
  try {
    registerTool(definition);
    writeOut(`${label}: aceita\n`);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    writeOut(`${label}:\n  ${error.message}\n`);
  }
}
