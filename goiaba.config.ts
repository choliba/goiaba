import { hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { ecsFormat } from '@elastic/ecs-pino-format';
import pino from 'pino';
import { defineConfig } from './src/config';


const dirRoot = dirname(__filename)
const storage = join(dirRoot, 'storage')

const destination = (dest: string) =>
  pino.destination({ dest, sync: true, mkdir: true, mode: 0o600 });

export default defineConfig({
  debug: true,
  logger: {
    dir: join(storage, 'logs'), // relativo a este arquivo
    // Trocar de pacote muda só esta função; erros têm log.level "error".
    use: ({ dir, session }) =>
      pino(
        {
          ...ecsFormat({ serviceName: 'goiaba', serviceVersion: '0.1.0' }),
          level: 'debug',
          // Sem pid: process.* descreve o comando de cada evento.
          base: { hostname: hostname() },
        },
        destination(join(dir, `${session}.jsonl`)),
      ),
  },
  database: {
    dir: join(storage, 'db'), // relativo a este arquivo
    name: 'batata.db',
  },
  envs: [
    {
      CURSOR_API_KEY: process.env['CURSOR_API_KEY'],
      CLAUDE_CODE_OAUTH_TOKEN: process.env['CLAUDE_CODE_OAUTH_TOKEN'],
      // Pasta onde os agentes trabalham.
      workspace: join(storage, 'workspace'),
    },
  ],
});
