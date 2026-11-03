/**
 * Exemplo 1 do curso do agente: o menor agente. Um agente junta um provider
 * (qual CLI roda), um workspace (onde) e uma conversa (com quem fala). Aqui
 * o provider é de mentira, para rodar sem modelo nem rede: a "CLI" é o
 * próprio bun, que responde o que recebeu em maiúsculas.
 */
import { randomUUID } from 'node:crypto';

import { Agent } from '../../../src/agent/agent';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

/** Uma "CLI" que lê o pedido no stdin e responde em maiúsculas. */
class ShoutProvider implements Provider<string, string> {
  public readonly id = 'grito';

  public createCommand(input: string): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        'process.stdout.write((await Bun.stdin.text()).toUpperCase())',
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

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  try {
    await new Agent({
      name: 'gritador',
      prompt: 'diga oi',
      provider: new ShoutProvider(),
      workspace: new Workspace({ type: 'bubblewrap', root }),
      // Uma tarefa: o agente termina quando o provider responde.
      conversation: false,
    }).run();
  } finally {
    removePath(root);
  }
});
