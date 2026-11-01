/**
 * Uma AgentPolicy consultada sem agente nenhum.
 *
 *   bun agents/meus-testes/policy.ts
 *
 * 1. `check`: só decide. Para `require_approval`, devolve a decisão e para.
 * 2. `authorize`: decide e, se a resposta for `require_approval`, pergunta a
 *    quem você passar (aqui, o terminal). `allow` e `deny` não perguntam.
 */

import {
  PolicyEngine,
  type AgentAction,
  type ApprovalHandler,
} from '../../src/policy/index';
import { TerminalInteraction } from '../../src/interaction/index';

function escreva(text: string): void {
  console.log('escreva', text);
}

async function chamarEscreva(text: string): Promise<void> {
  const allowed = await policy.authorize(
    { category: 'tools', operation: 'call', tool: 'escreva' },
    askInTerminal,
  );
  if (allowed) escreva(text);
}

const policy = new PolicyEngine({
  default: 'deny',
  allow: {
    // execution: [{ commands: ['git *', 'bun *', 'ls *'] }],
    // Ferramentas: `servidor/ferramenta`. O `*` não atravessa a `/`.
    tools: [
      {
        operations: ['call'],
        tools: ['github/*', 'calc/*', 'escreva'],
        ignores: { tools: ['github/delete_repository'] },
      },
    ],
  },
  requireApproval: {
    tools: [{ operations: ['call'], tools: ['escreva'] }],
  },
  // deny: { execution: [{ commands: ['git push --force *'] }] },
});

const actions: readonly AgentAction[] = [
  // Comandos: só o texto da linha.
  // { category: 'execution', command: 'git status' },
  // { category: 'execution', command: 'git push origin main' },
  // { category: 'execution', command: 'git push --force origin main' },
  // { category: 'execution', command: 'rm -rf build' },
  // // Ferramentas: a operação (`call`) e o nome.
  // { category: 'tools', operation: 'call', tool: 'github/list_issues' },
  // { category: 'tools', operation: 'call', tool: 'github/create_issue' },
  // { category: 'tools', operation: 'call', tool: 'github/delete_repository' },
  // { category: 'tools', operation: 'call', tool: 'calc/add' },
  { category: 'tools', operation: 'call', tool: 'escreva' },
];

const terminal = new TerminalInteraction();

// 1. check: a decisão de cada ação, e de onde ela veio (`source`).
terminal.write('1. check: só decide\n');
for (const action of actions) {
  const { policy: decision, source } = policy.check(action);
  terminal.write(`  ${describe(action)} → ${decision} (${source})`);
}

/** Pergunta no terminal, com uma tecla: s ou n. */
const askInTerminal: ApprovalHandler = async ({ action, decision }) => {
  terminal.write(`    ${decision.reason}`);
  terminal.write(`    Permitir ${describe(action)}? [s/n]`);
  return (await terminal.choose(['s', 'n'])) === 's';
};

await chamarEscreva('teste');

// 2. authorize: só a ação em requireApproval chega a perguntar.
terminal.write('\n2. authorize: decide e, se precisar, pergunta\n');
for (const action of actions) {
  terminal.write(`  ${describe(action)}`);
  const allowed = await policy.authorize(action, askInTerminal);
  terminal.write(`    → ${allowed ? 'pode' : 'não pode'}`);
}

terminal.close();

function describe(action: AgentAction): string {
  if (action.category === 'execution') return action.command;
  if (action.category === 'tools') return `ferramenta ${action.tool}`;
  return JSON.stringify(action);
}
