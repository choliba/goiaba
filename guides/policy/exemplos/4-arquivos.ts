/**
 * Exemplo 4 do curso de policy: a política de arquivos vira montagens da
 * sandbox (`compileFilesystemAccess`). Rode na raiz do repositório: os
 * caminhos mascarados precisam existir (node_modules, .env, guides).
 */
import { currentDirectory } from '../../../src/execute/process';
import { writeOut } from '../../../src/output/stdio';
import {
  compileFilesystemAccess,
  type AgentPolicy,
} from '../../../src/policy/index';

const root = currentDirectory();

// Escreve em tudo, menos node_modules (escondido); .env nunca é lido.
const project: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [
      {
        operations: ['read', 'write'],
        paths: ['/workspace/**'],
        ignores: { paths: ['/workspace/node_modules/**'] },
      },
    ],
  },
  deny: {
    filesystem: [{ operations: ['read'], paths: ['/workspace/.env'] }],
  },
};

// Lê tudo, escreve só em guides/ (como o Instructor).
const guidesOnly: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [
      { operations: ['read'], paths: ['/workspace/**'] },
      { operations: ['write'], paths: ['/workspace/guides/**'] },
    ],
  },
};

for (const [name, policy] of [
  ['project', project],
  ['guidesOnly', guidesOnly],
] as const) {
  const access = compileFilesystemAccess(policy, root);
  writeOut(
    `${name}: ${JSON.stringify(access, null, 2).replaceAll(root, '<root>')}\n`,
  );
}
