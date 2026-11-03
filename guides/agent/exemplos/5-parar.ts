/**
 * Exemplo 5 do curso do agente: parar. `status()` diz em que pé o agente
 * está. `stop()` interrompe o turno (o CLI recebe SIGTERM) e fecha a
 * sandbox; `destroy()` encerra de vez: o agente não pode mais ser usado.
 * Aqui a "CLI" demora 5 segundos, e paramos o agente antes disso.
 */
import { randomUUID } from 'node:crypto';

import { Agent } from '../../../src/agent/agent';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/stdio';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

class SlowProvider implements Provider<string, string> {
  public readonly id = 'devagar';

  public createCommand(): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: ['-e', 'await Bun.sleep(5000); console.log("pronto")'],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') yield { type: 'output', value: chunk };
    }
  }
}

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  const agent = new Agent({
    name: 'devagar',
    prompt: 'demore',
    provider: new SlowProvider(),
    workspace: new Workspace({ type: 'bubblewrap', root }),
    conversation: false,
    interaction: {
      ask: () => Promise.reject(new Error('nada a perguntar')),
      write: () => undefined,
    },
  });

  try {
    writeOut(`antes:        ${agent.status()}\n`);
    const running = agent.run();
    await new Promise((resolve) => setTimeout(resolve, 300));
    writeOut(`rodando:      ${agent.status()}\n`);

    const startedAt = performance.now();
    await agent.stop();
    await running;
    const seconds = (performance.now() - startedAt) / 1000;
    writeOut(
      `depois do stop: ${agent.status()} (${seconds < 1 ? 'em menos de 1 s' : 'demorou'}, sem esperar os 5 s)\n`,
    );

    await agent.destroy();
    writeOut(`destroy:      ${agent.status()}\n`);
    try {
      await agent.run();
    } catch (error) {
      writeOut(
        `run() de novo: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  } finally {
    removePath(root);
  }
});
