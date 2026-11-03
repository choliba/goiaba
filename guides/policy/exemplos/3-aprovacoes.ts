/**
 * Exemplo 3 do curso de policy: padrões aprovados durante a execução valem
 * como allow (`checkCommand` com `approved`), e o padrão que uma aprovação
 * ampla salvaria (`suggestPattern`).
 */
import { writeOut } from '../../../src/output/stdio';
import { PolicyEngine, suggestPattern } from '../../../src/policy/index';

const policy = new PolicyEngine({
  default: 'deny',
  allow: { execution: [{ commands: ['ls *'] }] },
  requireApproval: { execution: [{ commands: ['rm *'] }] },
  deny: { execution: [{ commands: ['rm -rf *'] }] },
});

// O que o gate passaria: aprovações dadas antes, com [s] ou [w].
const approved = ['rm *', 'touch *'];

for (const line of [
  'rm build.log',
  'touch novo.txt',
  'rm -rf dist',
  'ls src && touch a',
  'touch a > b',
]) {
  const before = policy.checkCommand(line);
  const after = policy.checkCommand(line, { approved });
  writeOut(
    `${line}: sem aprovação → ${before.policy} (${before.source}); com → ${after.policy} (${after.source})\n`,
  );
}

writeOut('\n');
for (const command of ['mkdir -p src/pages', 'cd a && rm b', 'cat > a']) {
  writeOut(
    `suggestPattern(${JSON.stringify(command)}) → ${suggestPattern(command)}\n`,
  );
}
