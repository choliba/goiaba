/** Exemplo 2 do curso de policy: uma linha de shell inteira (`checkCommand`). */
import { writeOut } from '../../../src/output/terminal';
import { PolicyEngine } from '../../../src/policy/index';

const policy = new PolicyEngine({
  default: 'deny',
  allow: { execution: [{ commands: ['git *', 'bun *', 'ls *'] }] },
  requireApproval: { execution: [{ commands: ['git push *'] }] },
  deny: { execution: [{ commands: ['git push --force *'] }] },
});

for (const line of ['ls src && bun test', 'ls src && rm x', 'ls > out.txt']) {
  const { policy: decision, source, reason } = policy.checkCommand(line);
  writeOut(`${line} → ${decision} (${source}): ${reason}\n`);
}
