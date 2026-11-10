/** Exemplo 3 do curso de providers: converter JSON da CLI em eventos. */
import type { ProgramOutput } from '../../../src/execute/types';
import { writeOut } from '../../../src/output/stdio';
import { CursorProvider } from '../../../src/providers/cursor/cursor-provider';

async function* cliOutput(): AsyncIterable<ProgramOutput> {
  yield {
    channel: 'stdout',
    chunk:
      '{"type":"system","subtype":"init","session_id":"sessao-1"}\n' +
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Pronto."}]}}\n',
  };
}

const provider = new CursorProvider({ model: 'modelo-local' });

for await (const event of provider.parseOutput(cliOutput())) {
  if (event.type === 'session') writeOut(`sessão: ${event.id}\n`);
  if (event.type === 'output') writeOut(`resposta: ${event.value}\n`);
}
