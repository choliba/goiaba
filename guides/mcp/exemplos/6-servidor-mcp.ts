/**
 * Exemplo 6 do curso de mcp: o servidor MCP de verdade. O broker prepara o
 * servidor (empacotado, com o SDK oficial) e um socket; o CLI do agente o
 * inicia dentro da sandbox e conversa por stdio, em JSON-RPC, uma mensagem
 * por linha. Aqui o exemplo faz o papel do CLI: apresenta-se (initialize),
 * pede a lista e chama uma ferramenta. Cada chamada volta ao broker, no
 * processo do Goiaba, onde `run` executa.
 */
import { Executor } from '../../../src/execute/index';
import { ToolBroker, tool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';

const inverter = tool({
  name: 'inverter_texto',
  description: 'Devolve o texto de trás para frente.',
  input: {
    type: 'object',
    properties: { texto: { type: 'string' } },
    required: ['texto'],
  },
  run: (input: { readonly texto: string }) =>
    // Por letra como se lê, não por código: um emoji continua inteiro.
    Array.from(
      new Intl.Segmenter('pt-BR').segment(input.texto),
      (piece) => piece.segment,
    )
      .toReversed()
      .join(''),
});

const broker = new ToolBroker({ tools: [inverter], policy: undefined });
await broker.start();

// O que um CLI manda: apresentar-se, avisar que está pronto, listar, chamar.
const requests = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'exemplo', version: '1' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'inverter_texto', arguments: { texto: 'goiabada' } },
  },
];

try {
  // A linha de comando que o CLI usaria: `<bun> <servidor> <socket>`.
  const [executable = '', ...args] = broker.serverCommand().command;
  let stdout = '';
  for await (const { channel, chunk } of new Executor().run({
    executable,
    arguments: args,
    // Fechar o stdin no fim é o que encerra o servidor, como quando o CLI sai.
    input: requests.map((request) => JSON.stringify(request)).join('\n') + '\n',
  })) {
    if (channel === 'stdout') stdout += chunk;
  }
  for (const line of stdout.trim().split('\n')) {
    writeOut(`${line}\n`);
  }
} finally {
  await broker.close();
}
