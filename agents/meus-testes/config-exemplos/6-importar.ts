/**
 * Exemplo 6 do curso de config: importar o Goiaba já carrega o
 * goiaba.config.ts do projeto (procurando do diretório atual para cima).
 * Rode na raiz do repositório.
 */
import { getConfig, isConfigLoaded } from '../../../src/index';
import { currentDirectory } from '../../../src/execute/process';
import { writeOut } from '../../../src/output/terminal';

const root = currentDirectory();
const config = getConfig();

writeOut(`isConfigLoaded(): ${String(isConfigLoaded())}\n`);
writeOut(
  `configPath: ${String(config.configPath).replaceAll(root, '<raiz>')}\n`,
);
writeOut(`logger.dir: ${config.logger.dir.replaceAll(root, '<raiz>')}\n`);
writeOut(
  `logger.use: ${config.logger.use === undefined ? 'não' : 'sim (pino)'}\n`,
);
writeOut(`databasePath: ${config.databasePath.replaceAll(root, '<raiz>')}\n`);
writeOut(`debug: ${String(config.debug)}\n`);
writeOut(
  `envs: ${String(config.envs.length)}, variáveis do env ativo: ${Object.keys(config.env?.vars ?? {}).join(', ')}\n`,
);
