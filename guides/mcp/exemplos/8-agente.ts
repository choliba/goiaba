/**
 * Exemplo 8 do curso de mcp: uma ferramenta nas mãos de um agente de
 * verdade. O provider vê a ferramenta porque o `tools` dele a nomeia, e pode
 * chamá-la porque a política a libera. Aqui, o Codex conduzindo um modelo
 * local no Ollama: o Codex recebe o servidor MCP por `-c mcp_servers…`, e
 * cada chamada volta ao Goiaba, onde `run` consulta a tabela. Precisa do
 * Ollama rodando, com o qwen3.5:4b baixado, e do Codex instalado.
 */
import { randomUUID } from 'node:crypto';

import { Agent } from '../../../src/agent/agent';
import { environment } from '../../../src/execute/process';
import {
  ensureDirectory,
  goiabaCacheDir,
  join,
  removePath,
} from '../../../src/filesystem/index';
import { registerTool } from '../../../src/mcp/index';
import { OllamaProvider } from '../../../src/providers/ollama/ollama-provider';
import { runScript } from '../../../src/usage';
import { Workspace } from '../../../src/workspace/index';

/** Uma consulta a uma tabela que só o Goiaba tem: o modelo não a vê. */
const PRECOS: ReadonlyMap<string, number> = new Map([
  ['goiaba', 7.9],
  ['queijo', 42.5],
  ['doce', 18],
]);

const CONSULTAR_PRECO = registerTool({
  name: 'consultar_preco',
  description: 'Consulta o preço do quilo de um produto da feira.',
  input: {
    type: 'object',
    properties: {
      produto: { type: 'string', description: 'O produto, como goiaba.' },
    },
    required: ['produto'],
    additionalProperties: false,
  },
  run: (input: { readonly produto: string }) => {
    const preco = PRECOS.get(input.produto.toLocaleLowerCase('pt-BR'));
    if (preco === undefined)
      throw new Error(`Não há preço para ${input.produto}.`);
    return { produto: input.produto, quilo: preco };
  },
});

// Uma pasta de trabalho de mentira, apagada no fim.
const root = join(goiabaCacheDir(environment()), 'mcp-exemplo', randomUUID());
ensureDirectory(root);

await runScript(async () => {
  try {
    await new Agent({
      name: 'feirante',
      resume: false,
      prompt:
        'Use a ferramenta consultar_preco para saber o preço do quilo da goiaba e diga quanto custam 2 quilos. Responda em uma frase.',
      provider: new OllamaProvider({
        cli: 'codex',
        model: 'qwen3.5:4b',
        contextWindow: 32768,
        tools: [CONSULTAR_PRECO],
      }),
      workspace: new Workspace({ type: 'bubblewrap', root, hostState: 'none' }),
      policy: {
        default: 'deny',
        allow: {
          filesystem: [{ operations: ['*'], paths: ['/workspace/**'] }],
          tools: [{ operations: ['call'], tools: [CONSULTAR_PRECO] }],
        },
      },
    }).run();
  } finally {
    removePath(root);
  }
});
