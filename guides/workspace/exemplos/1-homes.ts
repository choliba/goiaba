/** Exemplo 1 do curso de workspace: homes persistentes e hostState. */
import { getConfig } from '../../../src/config/index';
import { writeOut } from '../../../src/output/stdio';
import { Workspace } from '../../../src/workspace/index';

const root = '/workspace/app';
const login = new Workspace({ type: 'bubblewrap', root });
const sameRoot = new Workspace({
  type: 'bubblewrap',
  root: '/workspace/./app',
});
const isolated = new Workspace({
  type: 'bubblewrap',
  root,
  hostState: 'none',
});
const shared = new Workspace({
  type: 'bubblewrap',
  root,
  hostState: 'share',
});
const homesDir = getConfig().homes.dir;

writeOut(`hostState padrão: ${login.hostState}\n`);
writeOut(`home: ${login.home().replace(homesDir, '<homes>')}\n`);
writeOut(
  `mesma raiz, mesmo home: ${String(login.home() === sameRoot.home())}\n`,
);
writeOut(`hostState sem login: ${isolated.hostState}\n`);
writeOut(`hostState compartilhado: ${shared.hostState}\n`);
