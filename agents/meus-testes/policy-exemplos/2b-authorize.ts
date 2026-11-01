/**
 * Exemplo 2b do curso de policy: decidir e, só em `require_approval`,
 * perguntar (`authorize`). Responda com uma tecla: s ou n.
 */
import { StandardOutput } from '../../../src/output/index';
import {
  PolicyEngine,
  type AgentAction,
  type ApprovalRequest,
} from '../../../src/policy/index';

const policy = new PolicyEngine({
  default: 'deny',
  allow: { execution: [{ commands: ['git *', 'bun *', 'ls *'] }] },
  requireApproval: { execution: [{ commands: ['git push *'] }] },
  deny: { execution: [{ commands: ['git push --force *'] }] },
});

const terminal = new StandardOutput();

/** Quem pergunta: o terminal, com uma tecla. */
async function askInTerminal({
  action,
  decision,
}: ApprovalRequest): Promise<boolean> {
  terminal.write(`    ${decision.reason}`);
  terminal.write(`    Permitir ${describe(action)}? [s/n]`);
  return (await terminal.choose(['s', 'n'])) === 's';
}

function describe(action: AgentAction): string {
  return action.category === 'execution'
    ? action.command
    : JSON.stringify(action);
}

for (const command of [
  'git status',
  'git push origin main',
  'git push --force origin main',
  'rm -rf build',
]) {
  terminal.write(`  ${command}`);
  const allowed = await policy.authorize(
    { category: 'execution', command },
    askInTerminal,
  );
  terminal.write(`    → ${allowed ? 'pode' : 'não pode'}`);
}

terminal.close();
