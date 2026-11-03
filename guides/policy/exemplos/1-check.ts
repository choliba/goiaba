/** Exemplo 1 do curso de policy: a decisão de uma ação (`check`). */
import { writeOut } from '../../../src/output/stdio';
import { PolicyEngine } from '../../../src/policy/index';

const policy = new PolicyEngine({
  default: 'deny',
  allow: { execution: [{ commands: ['git *', 'bun *', 'ls *'] }] },
  requireApproval: { execution: [{ commands: ['git push *'] }] },
  deny: { execution: [{ commands: ['git push --force *'] }] },
});

for (const command of [
  'git status',
  'git push origin main',
  'git push --force origin main',
  'rm -rf build',
]) {
  const { policy: decision, source } = policy.check({
    category: 'execution',
    command,
  });
  writeOut(`${command} → ${decision} (${source})\n`);
}
