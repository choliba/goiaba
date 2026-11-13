/**
 * Exemplo 3 do curso de mcp: a política decide quais ferramentas o agente
 * pode chamar. O broker nem lista as outras: o modelo não as vê. As regras
 * são as do AgentPolicy, na categoria `tools`, com o nome `goiaba/<nome>`.
 * Pedir aprovação é negar: dentro do servidor MCP ninguém aprova.
 */
import { ToolBroker, tool, type AgentTool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';
import type { AgentPolicy } from '../../../src/policy/policy.interface';

/** Ferramentas que só dizem o próprio nome: aqui importa quem as vê. */
const named = (name: string): AgentTool =>
  tool({
    name,
    description: `A ferramenta ${name}.`,
    input: { type: 'object' },
    run: () => name,
  });

const tools = [
  named('consultar_ticket'),
  named('fechar_ticket'),
  named('apagar_ticket'),
];

const policies: [string, AgentPolicy | undefined][] = [
  ['sem política', undefined],
  [
    'só consultar',
    {
      default: 'deny',
      allow: {
        tools: [{ operations: ['call'], tools: ['goiaba/consultar_ticket'] }],
      },
    },
  ],
  [
    'todas, menos apagar',
    {
      default: 'deny',
      allow: { tools: [{ operations: ['call'], tools: ['goiaba/*'] }] },
      deny: {
        tools: [{ operations: ['call'], tools: ['goiaba/apagar_ticket'] }],
      },
    },
  ],
  [
    'fechar pede aprovação',
    {
      default: 'allow',
      requireApproval: {
        tools: [{ operations: ['call'], tools: ['goiaba/fechar_ticket'] }],
      },
    },
  ],
];

for (const [label, policy] of policies) {
  const broker = new ToolBroker({ tools, policy });
  const seen = broker.allowed().map((found) => found.name);
  const call = await broker.call('apagar_ticket', {});
  writeOut(
    `${label}:\n  vê: ${seen.join(', ') || '(nenhuma)'}\n  apagar_ticket: ${call.isError ? call.text : 'chamada'}\n`,
  );
  await broker.close();
}
