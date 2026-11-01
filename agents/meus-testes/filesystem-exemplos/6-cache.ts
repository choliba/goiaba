/**
 * Exemplo 6 do curso de filesystem: onde o Goiaba guarda o que é dele. O
 * ambiente entra como parâmetro: o filesystem não lê o processo.
 */
import { environment } from '../../../src/execute/process';
import { goiabaCacheDir } from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/terminal';

const home = environment()['HOME'] ?? '';
const hide = (path: string): string => path.replace(home, '~');

writeOut(
  `com o ambiente do processo: ${hide(goiabaCacheDir(environment()))}\n`,
);
writeOut(
  `com XDG_CACHE_HOME=/var/cache: ${goiabaCacheDir({ XDG_CACHE_HOME: '/var/cache' })}\n`,
);
writeOut(
  `com XDG_CACHE_HOME vazio:     ${hide(goiabaCacheDir({ XDG_CACHE_HOME: '' }))}\n`,
);
