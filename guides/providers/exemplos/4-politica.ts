/** Exemplo 4 do curso de providers: traduzir política para as regras do Claude. */
import type { AgentPolicy } from '../../../src/policy/policy.interface';
import { writeOut } from '../../../src/output/stdio';
import { buildClaudePermissions } from '../../../src/providers/claude/permissions';

const policy: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [{ operations: ['read'], paths: ['/workspace/src/**'] }],
    execution: [{ commands: ['bun test'] }],
  },
};

const claude = buildClaudePermissions(policy);

writeOut(`permitidas: ${claude.native.allow.join(', ')}\n`);
writeOut(`não expressas: ${claude.unsupported.length}\n`);
