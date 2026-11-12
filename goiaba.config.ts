import { hostname } from 'node:os';
import { dirname, join } from './src/filesystem/index';
import { ecsFormat } from '@elastic/ecs-pino-format';
import pino from 'pino';
import { defineConfig } from './src/config';
import { environment } from './src/execute/process';

// define diretórios
const dirRoot = dirname(__filename);
const dirStorage = join(dirRoot, 'storage');

// DEBUG=1 (ou true) liga o debug e o log em nível debug
const DEBUG = ['1', 'true'].includes(environment()['DEBUG'] ?? '');

// resolve o destino do log, criando diretórios se necessário
const destination = (dest: string) =>
  pino.destination({ dest, sync: true, mkdir: true, mode: 0o600 });

// cria um logger pino com ECS e nível de log configurável
type LoggerPinoOptions = { dir: string; session: string };
const loggerPino = ({ dir, session }: LoggerPinoOptions) =>
  pino(
    {
      ...ecsFormat({ serviceName: 'goiaba', serviceVersion: '0.1.0' }),
      level: DEBUG ? 'debug' : 'info',
      // Sem pid: process.* descreve o comando de cada evento.
      base: { hostname: hostname() },
    },
    destination(join(dir, `${session}.jsonl`)),
  );

export default defineConfig({
  debug: DEBUG,
  logger: {
    dir: join(dirStorage, 'logs'), // relativo a este arquivo
    // Trocar de pacote muda só esta função; erros têm log.level "error".
    use: loggerPino,
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
