/**
 * Exemplo 3 do curso do agente: acompanhar o que o agente faz. Cada função
 * de `subscribe` recebe um AgentOutput por evento, na hora: o tipo
 * (`type()`), o que veio com ele (`data()`), quando (`ts()`) e o agente
 * (`agent()`). É assim que um painel ou um site acompanha um agente.
 */
import { randomUUID } from 'node:crypto';

import { Agent } from '../../../src/agent/agent';
import type { AgentOutput } from '../../../src/agent/output';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import { writeOut } from '../../../src/output/stdio';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

class EchoProvider implements Provider<string, string> {
  public readonly id = 'eco';

  public createCommand(input: string): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        'process.stdout.write(`eco: ${await Bun.stdin.text()}`)',
      ],
      input,
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

/** Mostra cada evento numa linha: o tipo e o que veio com ele. */
function painel(event: AgentOutput): void {
  writeOut(
    `[${event.agent().name}] ${event.type().padEnd(8)} ${JSON.stringify(event.data())}\n`,
  );
}

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  try {
    await new Agent({
      name: 'eco',
      prompt: 'olá',
      provider: new EchoProvider(),
      workspace: new Workspace({ type: 'bubblewrap', root }),
      conversation: false,
      // Uma conversa que não mostra nada, e sem linha de status (por isso
      // o "pensando" vira uma mensagem): só o painel aparece.
      interaction: {
        ask: () => Promise.reject(new Error('nada a perguntar')),
        write: () => undefined,
      },
      subscribe: [painel],
    }).run();
  } finally {
    removePath(root);
  }
});
