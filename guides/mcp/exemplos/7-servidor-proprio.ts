/**
 * Exemplo 7 do curso de mcp: um servidor MCP próprio, com `serveTools`, sem
 * broker nem agente. Serve a qualquer cliente MCP (um CLI, um editor): você
 * diz quais ferramentas há (`list`) e o que cada chamada devolve (`call`); o
 * protocolo é do SDK oficial. Chamado com `servir`, este arquivo é o
 * servidor; sem argumento, ele se inicia como servidor e conversa com ele,
 * como um cliente faria.
 */
import { Executor } from '../../../src/execute/index';
import {
  programArguments,
  runtimeExecutable,
} from '../../../src/execute/process';
import { isRecord } from '../../../src/mcp/index';
import { serveTools, type McpTool } from '../../../src/mcp/server';
import { writeOut } from '../../../src/output/stdio';

const tools: readonly McpTool[] = [
  {
    name: 'formatar_reais',
    description: 'Escreve um valor em reais, como R$ 1.234,50.',
    inputSchema: {
      type: 'object',
      properties: { valor: { type: 'number' } },
      required: ['valor'],
    },
  },
  {
    name: 'maiusculas',
    description: 'Devolve o texto em letras maiúsculas.',
    inputSchema: {
      type: 'object',
      properties: { texto: { type: 'string' } },
      required: ['texto'],
    },
  },
];

if (programArguments()[0] === 'servir') {
  await serveTools(
    { name: 'utilidades', version: '1' },
    {
      list: () => Promise.resolve(tools),
      call: (name, input) => {
        if (name === 'formatar_reais' && typeof input['valor'] === 'number') {
          const text = input['valor'].toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          });
          return Promise.resolve({ text, isError: false });
        }
        if (name === 'maiusculas' && typeof input['texto'] === 'string') {
          return Promise.resolve({
            text: input['texto'].toLocaleUpperCase('pt-BR'),
            isError: false,
          });
        }
        return Promise.resolve({
          text: `Não sei chamar ${name} com essa entrada.`,
          isError: true,
        });
      },
    },
  );
} else {
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
      params: { name: 'formatar_reais', arguments: { valor: 1234.5 } },
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'maiusculas', arguments: { texto: 'goiabada' } },
    },
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'maiusculas', arguments: { valor: 1 } },
    },
  ];
  let stdout = '';
  for await (const { channel, chunk } of new Executor().run({
    executable: runtimeExecutable(),
    arguments: [import.meta.path, 'servir'],
    input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
  })) {
    if (channel === 'stdout') stdout += chunk;
  }
  for (const line of stdout.trim().split('\n')) {
    const message: unknown = JSON.parse(line);
    if (!isRecord(message)) continue;
    writeOut(
      `${String(message['id'])}: ${JSON.stringify(message['result'])}\n`,
    );
  }
}
