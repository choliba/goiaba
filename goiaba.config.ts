import { dirname, join } from './src/filesystem/index';
import { defineConfig } from './src/config';
import { environment } from './src/execute/process';
import { pinoLogger } from './config/pino.config';

// define diretórios
const dirRoot = dirname(__filename);
const dirStorage = join(dirRoot, 'storage');

// DEBUG=1 (ou true) liga o debug e o log em nível debug
const DEBUG = ['1', 'true'].includes(environment()['DEBUG'] ?? '');

const normalise = (e: string) => {
  return environment()[e];
  // const _ENVIROMENT_ = ['1', 'true'].includes(environment()['DEBUG'] ?? '');
};

export default defineConfig({
  debug: DEBUG,
  logger: {
    dir: join(dirStorage, 'logs'), // relativo a este arquivo
    // Trocar de pacote muda só esta função; erros têm log.level "error".
    use: pinoLogger({ debug: DEBUG }),
    logrotate: {
      maxFileSize: '50kb', // limite suave: o registro termina inteiro, o próximo vai para <sessão>.2.jsonl
      days: 1, // sessões mais antigas que isso são apagadas
      maxTotalSize: '100kb', // se a pasta passar disso, apaga das mais antigas
      compress: true, // true: as sessões encerradas viram .jsonl.gz
    },
  },
  database: {
    dir: join(dirStorage, 'db'), // relativo a este arquivo
    name: 'batata.db',
  },
  workspaces: {
    // A raiz padrão dos workspaces: a pasta onde o agente trabalha
    // (getConfig().workspaces.dir). O `bun run clear --workspaces` a esvazia.
    dir: join(dirStorage, 'workspaces'),
    // O home da CLI de cada workspace, um por raiz: sessões e histórico
    // (getConfig().workspaces.homes). O `bun run clear --homes` a esvazia.
    homes: join(dirStorage, 'homes'),
  },
  rounds: {
    // As suas rodadas ficam fora deste repositório, em ~/dev/minhas-rodadas:
    // as declarações, as fixtures e os registros. Rodando daqui, o Goiaba usa
    // essas pastas (bun run rounds <id>, bun run rounds:web).
    // Onde as rodadas rodam: uma pasta por rodada (<dir>/<id>), recriada a
    // partir da fixture a cada execução. O `bun run clear --rounds` a esvazia.
    // dir: '~/dev/minhas-rodadas/rounds/rodadas',
    // definitions: '~/dev/minhas-rodadas/rounds/definitions',
    // fixtures: '~/dev/minhas-rodadas/rounds/fixtures',
    // data: '~/dev/minhas-rodadas/rounds/data',
    dir: normalise('ROUNDS_DIR'),
    definitions: normalise('ROUNDS_DEFINITIONS'),
    fixtures: normalise('ROUNDS_FIXTURES'),
    data: normalise('ROUNDS_DATA'),
  },
  envs: [
    {
      CURSOR_API_KEY: process.env['CURSOR_API_KEY'],
      CLAUDE_CODE_OAUTH_TOKEN: process.env['CLAUDE_CODE_OAUTH_TOKEN'],

      ROUNDS_DIR: process.env['ROUNDS_DIR'],
      ROUNDS_DEFINITIONS: process.env['ROUNDS_DEFINITIONS'],
      ROUNDS_FIXTURES: process.env['ROUNDS_FIXTURES'],
      ROUNDS_DATA: process.env['ROUNDS_DATA'],
    },
  ],
});
