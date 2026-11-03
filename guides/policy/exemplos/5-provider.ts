/**
 * Exemplo 5 do curso de policy: as categorias que a sandbox não aplica e
 * ficam para o provider traduzir (`delegatedCategories`).
 */
import { writeOut } from '../../../src/output/stdio';
import {
  delegatedCategories,
  type AgentPolicy,
} from '../../../src/policy/index';

const policy: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
    network: [{ operations: ['connect'], hosts: ['registry.npmjs.org'] }],
    web: [{ operations: ['search'], domains: ['*'] }],
    execution: [{ commands: ['ls *'] }],
  },
  deny: {
    communication: [{ operations: ['send_email'], channels: ['*'] }],
  },
};

writeOut(`${JSON.stringify(delegatedCategories(policy))}\n`);
