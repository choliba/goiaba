import { dirname, join } from './src/filesystem/index';
import { defineConfig } from './src/config';
import { environment } from './src/execute/process';
import { pinoLogger } from './config/pino.config';

// define diretórios
const dirRoot = dirname(__filename);
const dirStorage = join(dirRoot, 'storage');

// DEBUG=1 (ou true) liga o debug e o log em nível debug
const DEBUG = ['1', 'true'].includes(environment()['DEBUG'] ?? '');

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
    // Onde as rodadas rodam: uma pasta por rodada (<dir>/<id>), recriada a
    // partir da fixture a cada execução. Obrigatória para rodar rodadas e
    // fora do projeto. O `bun run clear --rounds` a esvazia.
    dir: '~/.local/share/goiaba/rounds/rodadas',
    // definitions: '~/.local/share/goiaba/rounds/definitions',
    // fixtures: '~/.local/share/goiaba/rounds/fixtures',
    // data: '~/.local/share/goiaba/rounds/data',
  },
  envs: [
    {
      CURSOR_API_KEY: process.env['CURSOR_API_KEY'],
      CLAUDE_CODE_OAUTH_TOKEN: process.env['CLAUDE_CODE_OAUTH_TOKEN'],
    },
  ],
});
