/**
 * Exemplo 2 do curso do agente: uma conversa. Com `conversation: true` (o
 * padrão), cada mensagem que chega é um turno: o agente responde e espera a
 * próxima. Aqui a conversa vem de uma lista (um adapter feito no exemplo), e
 * o agente para quando ela acaba. A "CLI" responde quantas letras ouviu.
 */
import { randomUUID } from 'node:crypto';

import { agentConversation, Agent } from '../../../src/agent/agent';
import { environment, runtimeExecutable } from '../../../src/execute/process';
import type { ProgramCommand, ProgramOutput } from '../../../src/execute/types';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import type {
  InputEvent,
  InteractionAdapter,
} from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

class CountProvider implements Provider<string, string> {
  public readonly id = 'contador';

  public createCommand(input: string): ProgramCommand {
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        'const t = (await Bun.stdin.text()).trim(); process.stdout.write(`"${t}" tem ${t.length} letras`)',
      ],
      input,
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    // Numa conversa, o provider diz qual é a sessão: o turno seguinte a usa.
    yield { type: 'session', id: 'conversa-de-exemplo' };
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') yield { type: 'output', value: chunk };
    }
  }
}

/** As mensagens de quem conversa, uma depois da outra; depois, o fim. */
function messages(lines: readonly string[]): InteractionAdapter {
  return {
    events: async function* (): AsyncGenerator<InputEvent> {
      for (const text of lines) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await stdioOutput.write(`› ${text}`);
        yield { type: 'message', text };
      }
    },
    request: () => undefined,
    output: stdioOutput,
    close: () => undefined,
  };
}

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  try {
    await new Agent({
      name: 'contador',
      prompt: 'oi',
      provider: new CountProvider(),
      workspace: new Workspace({ type: 'bubblewrap', root }),
      interaction: agentConversation(messages(['goiaba', 'tudo bem?'])),
      resume: false,
    }).run();
  } finally {
    removePath(root);
  }
});
