import { hostname } from 'node:os';

import { ecsFormat } from '@elastic/ecs-pino-format';
import pino from 'pino';

import type { LoggerFactory } from '../src/config';
import { join } from '../src/filesystem/index';

/** O destino do log: síncrono, criando a pasta, só o dono lê. */
const destination = (dest: string) =>
  pino.destination({ dest, sync: true, mkdir: true, mode: 0o600 });

/**
 * O `logger.use` com pino e ECS. Recebe o `debug` de quem chama (o
 * goiaba.config.ts): este arquivo é importado enquanto a configuração ainda
 * está carregando, e um getConfig() aqui leria os padrões, não o arquivo.
 */
export const pinoLogger =
  ({ debug }: { readonly debug: boolean }): LoggerFactory =>
  ({ dir, session }) =>
    pino(
      {
        ...ecsFormat({ serviceName: 'goiaba', serviceVersion: '0.1.0' }),
        level: debug ? 'debug' : 'info',
        // Sem pid: process.* descreve o comando de cada evento.
        base: { hostname: hostname() },
      },
      destination(join(dir, `${session}.jsonl`)),
    );
