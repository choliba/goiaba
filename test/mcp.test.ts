import { afterEach, describe, expect, test } from 'bun:test';

import { ClaudeProvider } from '../src/providers/claude/claude-provider';
import {
  clearTools,
  registerTool,
  registeredTool,
  tool,
  ToolBroker,
  type AgentTool,
} from '../src/mcp/index';

afterEach(() => clearTools());

const echo: AgentTool = {
  name: 'ecoar',
  description: 'Devolve o texto que recebe.',
  input: {
    type: 'object',
    properties: { texto: { type: 'string' } },
    required: ['texto'],
    additionalProperties: false,
  },
  run: (input) => `eco: ${String(input['texto'])}`,
};

describe('tool e registerTool', () => {
  test('recusam nome fora do padrão e descrição vazia', () => {
    expect(() => tool({ ...echo, name: 'Ecoar' })).toThrow('letras minúsculas');
    expect(() => tool({ ...echo, description: ' ' })).toThrow(
      'precisa de uma descrição',
    );
  });

  test('registrar devolve o nome goiaba/<nome>; o mesmo nome duas vezes é recusado', () => {
    expect(registerTool(echo)).toBe('goiaba/ecoar');
    expect(registeredTool('goiaba/ecoar').name).toBe('ecoar');
    expect(() => registerTool(echo)).toThrow('Já há uma ferramenta');
  });

  test('uma ferramenta não registrada diz quais existem', () => {
    registerTool(echo);
    expect(() => registeredTool('goiaba/outra')).toThrow(
      'As registradas: goiaba/ecoar.',
    );
  });
});

describe('ToolBroker', () => {
  const failing: AgentTool = {
    ...echo,
    name: 'quebrar',
    run: () => {
      throw new Error('a API caiu');
    },
  };

  test('a política decide o que existe para o agente', () => {
    const broker = new ToolBroker({
      tools: [echo, failing],
      policy: {
        default: 'deny',
        allow: { tools: [{ operations: ['call'], tools: ['goiaba/ecoar'] }] },
      },
    });
    expect(broker.allowed().map((t) => t.name)).toEqual(['ecoar']);
  });

  test('confere a entrada, executa e devolve o erro da ferramenta como falha', async () => {
    const broker = new ToolBroker({
      tools: [echo, failing],
      policy: undefined,
    });
    expect(await broker.call('ecoar', { texto: 'oi' })).toEqual({
      text: 'eco: oi',
      isError: false,
    });
    expect(await broker.call('ecoar', {})).toEqual({
      text: 'Faltam campos obrigatórios: texto.',
      isError: true,
    });
    expect(await broker.call('ecoar', { texto: 1 })).toEqual({
      text: 'O campo texto deve ser do tipo string.',
      isError: true,
    });
    expect(await broker.call('quebrar', { texto: 'x' })).toEqual({
      text: 'a API caiu',
      isError: true,
    });
    expect((await broker.call('nenhuma', {})).isError).toBe(true);
  });

  test('o servidor MCP lista e chama as ferramentas pelo socket, como o CLI faria', async () => {
    const broker = new ToolBroker({ tools: [echo], policy: undefined });
    await broker.start();
    const [executable = '', ...args] = broker.serverCommand().command;
    const server = Bun.spawn([executable, ...args], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    try {
      const requests = [
        // What a CLI sends, with the oldest version the CLIs still start with.
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'teste', version: '1' },
          },
        },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'ecoar', arguments: { texto: 'oi' } },
        },
      ];
      for (const request of requests) {
        void server.stdin.write(`${JSON.stringify(request)}\n`);
      }
      void server.stdin.flush();

      const responses = new Map<number, unknown>();
      const reader = server.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (responses.size < 3) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);
        for (const line of buffer.split('\n').slice(0, -1)) {
          const message: unknown = JSON.parse(line);
          if (
            typeof message === 'object' &&
            message !== null &&
            'id' in message &&
            typeof message.id === 'number'
          ) {
            responses.set(message.id, message);
          }
        }
        buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
      }

      expect(responses.get(1)).toMatchObject({
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'goiaba' },
          capabilities: { tools: {} },
        },
      });
      expect(responses.get(2)).toMatchObject({
        result: {
          tools: [
            {
              name: 'ecoar',
              description: 'Devolve o texto que recebe.',
              inputSchema: { type: 'object', required: ['texto'] },
            },
          ],
        },
      });
      expect(responses.get(3)).toEqual({
        jsonrpc: '2.0',
        id: 3,
        result: {
          content: [{ type: 'text', text: 'eco: oi' }],
          isError: false,
        },
      });
    } finally {
      server.kill();
      await broker.close();
    }
  });
});

describe('o servidor MCP com o stdin fechado logo depois dos pedidos', () => {
  test('responde a todos antes de sair', async () => {
    const broker = new ToolBroker({ tools: [echo], policy: undefined });
    await broker.start();
    const [executable = '', ...args] = broker.serverCommand().command;
    const server = Bun.spawn([executable, ...args], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    try {
      const requests = [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'teste', version: '1' },
          },
        },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'ecoar', arguments: { texto: 'fim' } },
        },
      ];
      void server.stdin.write(
        `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
      );
      // The client goes away at once: the answers must still come.
      void server.stdin.end();
      const out = await new Response(server.stdout).text();
      const ids = out
        .trim()
        .split('\n')
        .map((line): unknown => Reflect.get(Object(JSON.parse(line)), 'id'));
      expect(ids.toSorted((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3]);
      expect(out).toContain('eco: fim');
      expect(await server.exited).toBe(0);
    } finally {
      server.kill();
      await broker.close();
    }
  });
});

describe('ClaudeProvider com ferramentas registradas', () => {
  test('as do CLI vão no --tools; as registradas, por --mcp-config, liberadas nas configurações', () => {
    const provider = new ClaudeProvider({
      model: 'modelo',
      tools: ['file_read', 'goiaba/ecoar'],
    });
    expect(provider.ownTools()).toEqual(['goiaba/ecoar']);
    provider.applyPolicy(
      { default: 'deny', allow: { execution: [{ commands: ['ls'] }] } },
      { hookCommand: ['/bin/bun', '/gate/hook', '/gate/s.sock'], root: '/w' },
    );
    provider.applyTools({
      name: 'goiaba',
      command: ['/bin/bun', '/tools/server', '/tools/tools.sock'],
    });

    const args = provider.createCommand('pergunta').arguments ?? [];
    expect(
      args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2),
    ).toEqual(['--tools', 'Read']);
    expect(JSON.parse(args[args.indexOf('--mcp-config') + 1] ?? '')).toEqual({
      mcpServers: {
        goiaba: {
          command: '/bin/bun',
          args: ['/tools/server', '/tools/tools.sock'],
        },
      },
    });
    expect(args).toContain('--strict-mcp-config');
    const settings: unknown = JSON.parse(
      args[args.indexOf('--settings') + 1] ?? '',
    );
    expect(settings).toMatchObject({
      permissions: { allow: expect.arrayContaining(['mcp__goiaba']) },
    });
  });
});
