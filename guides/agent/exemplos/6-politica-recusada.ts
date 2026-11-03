/**
 * Exemplo 6 do curso do agente: uma política que o provider não aplica é
 * recusada na hora, ao criar o agente, com um UsageError que diz o porquê.
 * Nada roda: melhor do que um agente que parece protegido e não está. As
 * categorias web, execution e communication dependem do provider (a CLI as
 * aplica); este provider de exemplo não sabe aplicar nenhuma.
 */
import { randomUUID } from 'node:crypto';

import { Agent } from '../../../src/agent/agent';
import { UsageError } from '../../../src/errors';
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
import { Workspace } from '../../../src/workspace/index';

class PlainProvider implements Provider<string, string> {
  public readonly id = 'simples';

  public createCommand(input: string): ProgramCommand {
    return { executable: runtimeExecutable(), arguments: ['-e', ''], input };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { chunk } of output)
      yield { type: 'output', value: chunk };
  }
}

const root = join(goiabaCacheDir(environment()), 'agent-exemplo', randomUUID());
ensureDirectory(root);

try {
  const agent = new Agent({
    name: 'simples',
    prompt: 'rode os testes',
    provider: new PlainProvider(),
    workspace: new Workspace({ type: 'bubblewrap', root }),
    permissions: {
      default: 'deny',
      allow: {
        filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
        execution: [{ commands: ['bun test'] }],
      },
    },
  });
  writeOut(`o agente ${agent.name} foi criado\n`);
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  writeOut(`recusado: ${error.message}\n`);
} finally {
  removePath(root);
}
