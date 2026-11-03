/**
 * Exemplo 4 do curso do agente: a resposta em pedaços, e o raciocínio à
 * parte. Um provider que lê o modelo enquanto ele escreve manda `reasoning`
 * (o que o modelo pensou) e `partial` (cada pedaço da resposta), e depois a
 * resposta inteira (`output`). O agente leva os pedaços à conversa assim
 * que chegam; a saída daqui marca cada stream, para ver como ele chegou.
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
import type { InputEvent } from '../../../src/interaction/index';
import { completeOutput } from '../../../src/output/index';
import { writeOut } from '../../../src/output/stdio';
import type { Provider, ProviderEvent } from '../../../src/providers/types';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

/** Uma "CLI" que escreve, linha a linha, o que pensou e a resposta. */
class WriterProvider implements Provider<string, string> {
  public readonly id = 'escritor';

  public createCommand(): ProgramCommand {
    const lines = [
      'pensa:o pedido é simples',
      'parte:Uma goiaba ',
      'parte:é uma fruta.',
    ];
    return {
      executable: runtimeExecutable(),
      arguments: [
        '-e',
        `for (const line of ${JSON.stringify(lines)}) { console.log(line); await Bun.sleep(50); }`,
      ],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    let answer = '';
    for await (const { channel, chunk } of output) {
      if (channel !== 'stdout') continue;
      for (const line of chunk.split('\n').filter((text) => text !== '')) {
        const [kind, text = ''] = line.split(/:(.*)/s);
        if (kind === 'pensa') yield { type: 'reasoning', text };
        if (kind === 'parte') {
          answer += text;
          yield { type: 'partial', text };
        }
      }
    }
    yield { type: 'output', value: answer };
  }
}

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  try {
    await new Agent({
      name: 'escritor',
      prompt: 'o que é uma goiaba?',
      provider: new WriterProvider(),
      workspace: new Workspace({ type: 'bubblewrap', root }),
      conversation: false,
      interaction: agentConversation({
        events: async function* (): AsyncGenerator<InputEvent> {
          // Uma tarefa: ninguém digita nada.
        },
        request: () => undefined,
        output: completeOutput({
          write: (text, kind = 'message') => {
            writeOut(`${kind}: ${JSON.stringify(text)}\n`);
          },
          writeStream: async (pieces, kind = 'message') => {
            const got: string[] = [];
            for await (const piece of pieces) got.push(piece);
            writeOut(
              `${kind} em pedaços: ${got.map((piece) => JSON.stringify(piece)).join(' + ')}\n`,
            );
          },
        }),
        close: () => undefined,
      }),
    }).run();
  } finally {
    removePath(root);
  }
});
