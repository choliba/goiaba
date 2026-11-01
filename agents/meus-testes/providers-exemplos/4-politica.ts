/** Exemplo 4 do curso de providers: traduzir política para as regras do Claude. */
import type { AgentPolicy } from '../../../src/policy/policy.interface';
import { writeOut } from '../../../src/output/terminal';
import { buildClaudePermissions } from '../../../src/providers/claude/permissions';

const policy: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [{ operations: ['read'], paths: ['/workspace/src/**'] }],
    execution: [{ commands: ['bun test'] }],
  },
};

const permissions = buildClaudePermissions(policy);

writeOut(`permitidas: ${permissions.native.allow.join(', ')}\n`);
writeOut(`não expressas: ${permissions.unsupported.length}\n`);
