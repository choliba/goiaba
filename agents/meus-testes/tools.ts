/**
 * Ferramentas suas, governadas por uma AgentPolicy: ler email, enviar email
 * e ler arquivo. O Goiaba não tem um registro de ferramentas: quem liga o
 * nome à função e consulta a política antes de rodar é este código.
 *
 *   bun agents/meus-testes/tools.ts
 *
 * Duas perguntas por chamada:
 * 1. `tools`: esta ferramenta pode ser chamada?
 * 2. a categoria do que ela toca: `communication` (o destinatário de um
 *    email) ou `filesystem` (o arquivo lido).
 */

import { currentDirectory } from '../../src/execute/process';
import { join, readText } from '../../src/filesystem/index';
import { StandardOutput } from '../../src/output/index';
import {
  PolicyEngine,
  type AgentAction,
  type ApprovalRequest,
} from '../../src/policy/index';

const policy = new PolicyEngine({
  default: 'deny',
  allow: {
    // Ler email e ler arquivo: sem perguntar.
    tools: [{ operations: ['call'], tools: ['email/read', 'files/read'] }],
    // Email só para a própria empresa.
    communication: [
      { operations: ['send_email'], channels: ['*@empresa.exemplo'] },
    ],
    // Arquivos: o README e a documentação.
    filesystem: [{ operations: ['read'], paths: ['README.md', 'docs/**'] }],
  },
  requireApproval: {
    // Enviar email: pergunta antes, sempre.
    tools: [{ operations: ['call'], tools: ['email/send'] }],
  },
  deny: {
    // Segredos: nunca, nem com aprovação.
    filesystem: [{ operations: ['*'], paths: ['.env', '**/*.key'] }],
  },
});

type Args = Readonly<Record<string, string>>;
type Tool = (args: Args) => Promise<string>;

const terminal = new StandardOutput();

// --- As ferramentas -------------------------------------------------------

/** Lê a caixa de entrada (aqui, uma de mentira). */
const readEmail: Tool = () =>
  Promise.resolve(
    [
      '1. de chefe@empresa.exemplo: reunião às 10h',
      '2. de cliente@fora.exemplo: proposta',
    ].join('\n'),
  );

/** Envia um email, se o destinatário for permitido (aqui, só simula). */
const sendEmail: Tool = async ({ to = '', subject = '' }) => {
  const allowed = await policy.authorize(
    { category: 'communication', operation: 'send_email', channel: to },
    ask,
  );
  if (!allowed) return `Destinatário não permitido: ${to}.`;
  return `Enviado para ${to}: "${subject}" (simulado).`;
};

/** Lê um arquivo do projeto, se o caminho for permitido. */
const readFile: Tool = async ({ path = '' }) => {
  const allowed = await policy.authorize(
    { category: 'filesystem', operation: 'read', path },
    ask,
  );
  if (!allowed) return `Leitura não permitida: ${path}.`;
  const [firstLine = ''] = readText(join(currentDirectory(), path)).split('\n');
  return `${path}: ${firstLine}`;
};

/** O registro: o nome que a política conhece → a função. */
const tools = new Map<string, Tool>([
  ['email/read', readEmail],
  ['email/send', sendEmail],
  ['files/read', readFile],
]);

/** Pergunta no terminal, com uma tecla: s ou n. */
async function ask({ action, decision }: ApprovalRequest): Promise<boolean> {
  terminal.write(`    ${decision.reason}`);
  terminal.write(`    Permitir ${describe(action)}? [s/n]`);
  return (await terminal.choose(['s', 'n'])) === 's';
}

/** Chama uma ferramenta pelo nome: primeiro a política, depois a função. */
async function callTool(name: string, args: Args = {}): Promise<string> {
  const tool = tools.get(name);
  const allowed = await policy.authorize(
    { category: 'tools', operation: 'call', tool: name },
    ask,
  );
  if (!allowed) return `Ferramenta não permitida: ${name}.`;
  if (tool === undefined) return `Ferramenta desconhecida: ${name}.`;
  return tool(args);
}

// --- As chamadas ----------------------------------------------------------

const calls: readonly [string, Args][] = [
  ['email/read', {}],
  ['files/read', { path: 'docs/agents.md' }],
  ['files/read', { path: '.env' }],
  ['email/send', { to: 'colega@empresa.exemplo', subject: 'Ata da reunião' }],
  ['email/send', { to: 'cliente@fora.exemplo', subject: 'Proposta' }],
  ['slack/send', { text: 'oi' }],
];

for (const [name, args] of calls) {
  terminal.write(`\n${name} ${JSON.stringify(args)}`);
  terminal.write(`  ${(await callTool(name, args)).replaceAll('\n', '\n  ')}`);
}

terminal.close();

function describe(action: AgentAction): string {
  if (action.category === 'tools') return `a ferramenta ${action.tool}`;
  if (action.category === 'communication')
    return `email para ${action.channel}`;
  if (action.category === 'filesystem') return `ler ${action.path}`;
  return JSON.stringify(action);
}
