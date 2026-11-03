import { hostname } from 'node:os';
import { dirname, join } from './src/filesystem/index';
import { ecsFormat } from '@elastic/ecs-pino-format';
import pino from 'pino';
import { defineConfig } from './src/config';

// define diretórios
const dirRoot = dirname(__filename);
const dirStorage = join(dirRoot, 'storage');

// resolve o destino do log, criando diretórios se necessário
const destination = (dest: string) =>
  pino.destination({ dest, sync: true, mkdir: true, mode: 0o600 });

// cria um logger pino com ECS e nível de log configurável
type LoggerPinoOptions = { dir: string; session: string };
const loggerPino = ({ dir, session }: LoggerPinoOptions) =>
  pino(
    {
      ...ecsFormat({ serviceName: 'goiaba', serviceVersion: '0.1.0' }),
      level: 'debug',
      // Sem pid: process.* descreve o comando de cada evento.
      base: { hostname: hostname() },
    },
    destination(join(dir, `${session}.jsonl`)),
  );

export default defineConfig({
  debug: true,
  logger: {
    dir: join(dirStorage, 'logs'), // relativo a este arquivo
    // Trocar de pacote muda só esta função; erros têm log.level "error".
    use: loggerPino,
  },
  database: {
    dir: join(dirStorage, 'db'), // relativo a este arquivo
    name: 'batata.db',
  },
  envs: [
    {
      CURSOR_API_KEY: process.env['CURSOR_API_KEY'],
      CLAUDE_CODE_OAUTH_TOKEN: process.env['CLAUDE_CODE_OAUTH_TOKEN'],
      // Pasta onde os agentes trabalham.
      workspace: join(dirStorage, 'workspaces'),
    },
  ],
});
