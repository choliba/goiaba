/**
 * A rede de uma sandbox passando pelo gate, no bubblewrap ou no docker, sem
 * modelo nenhum: o que sai da sandbox é um `curl`, e um consumidor do
 * produtor `network` mostra cada decisão.
 *
 *   bun guides/network/exemplos/network.ts bubblewrap
 *   bun guides/network/exemplos/network.ts docker
 *
 * O que muda entre as duas é só a sandbox: o gate e o proxy rodam aqui, no
 * host. No bubblewrap, o bridge sobe uma vez para a jaula; no docker, entra
 * como lançador de cada comando, com o container em `--network none`.
 */

import { defineCommand, runCommand } from '../../../src/command/index';
import { createConsumer } from '../../../src/events/index';
import { currentDirectory, runProgram } from '../../../src/execute/process';
import {
  NETWORK_SOURCE,
  NetworkBoundary,
  type NetworkRules,
} from '../../../src/network/index';
import { Workspace } from '../../../src/workspace/index';

/**
 * Só as regras de rede: o que esta sandbox pode acessar. Num agente, elas
 * vêm da política por `networkRulesOf(permissions)`; aqui, escritas direto.
 * Qualquer outro destino: o `default`.
 */
const rules: NetworkRules = {
  default: 'deny',
  allow: [{ operations: ['connect'], hosts: ['example.com'] }],
  // Os metadados da nuvem: nunca, nem com aprovação.
  deny: [{ operations: ['*'], hosts: ['169.254.169.254'] }],
};

/** Cada `curl` e o que se espera dele. */
const attempts = [
  {
    url: 'https://example.com',
    expected: '200: allow da política (pelo proxy)',
  },
  {
    url: 'https://www.wikipedia.org',
    expected: '403: nenhuma regra, o default nega',
  },
  {
    url: 'http://169.254.169.254',
    expected: '403: uma regra deny',
  },
  {
    url: 'https://example.com',
    noProxy: true,
    expected: '000: ignorando o proxy, a sandbox não tem rede',
  },
] as const;

await runCommand(
  defineCommand({
    name: 'network',
    description:
      'Mostra a rede de uma sandbox passando pelo gate (bubblewrap ou docker).',
    args: {
      sandbox: { description: 'bubblewrap ou docker', required: true },
    },
    run: async ({ args, output }) => {
      const root = currentDirectory();
      const workspace = createWorkspace(args.sandbox, root);

      // A sandbox fica sem rede própria: só sai pelo proxy, que pergunta ao gate.
      workspace.configureNetwork(
        new NetworkBoundary({
          rules,
          // Ninguém aprova nada neste exemplo.
          approve: () => Promise.resolve('deny'),
        }),
      );

      // Um consumidor das decisões do gate: de qualquer sandbox, aqui no host.
      const decisions = createConsumer((event) => {
        if (event.type !== 'decision') return;
        output.write(
          `   gate: ${String(event['hostname'])}:${String(event['port'])} → ${String(event['decision'])} (${String(event['decidedBy'])})`,
        );
      });
      decisions.subscribe(NETWORK_SOURCE);

      try {
        output.write(`Sandbox: ${args.sandbox}\n`);
        for (const { url, expected, ...rest } of attempts) {
          const noProxy = 'noProxy' in rest;
          output.write(`curl ${noProxy ? '--noproxy "*" ' : ''}${url}`);
          const code = await curl(workspace, url, noProxy);
          output.write(`   resposta: ${code}  (esperado ${expected})\n`);
        }
      } finally {
        decisions.unsubscribeAll();
        await workspace.close();
      }
    },
  }),
);

function createWorkspace(sandbox: string, root: string): Workspace {
  if (sandbox === 'bubblewrap')
    return new Workspace({ type: 'bubblewrap', root });
  if (sandbox === 'docker') {
    // Do Docker Hub, se ainda não estiver na máquina (veja image em docs/agents.md).
    return new Workspace({
      type: 'docker',
      root,
      image: 'FROM oven/bun:latest',
    });
  }
  throw new Error(
    `Sandbox desconhecida: ${sandbox}. Use bubblewrap ou docker.`,
  );
}

/**
 * O código HTTP do `curl` rodando dentro da sandbox; `000` sem conexão. Em
 * HTTPS, uma negação é a resposta do proxy ao CONNECT (`%{http_connect}`),
 * não a do destino (`%{http_code}`, que fica 000).
 */
async function curl(
  workspace: Workspace,
  url: string,
  noProxy: boolean,
): Promise<string> {
  const flags = noProxy ? '--noproxy "*"' : '';
  // `; true`: sem conexão o curl falha, mas o código (000) já foi impresso.
  const prepared = await workspace.prepare({
    executable: 'sh',
    arguments: [
      '-c',
      `curl -s -o /dev/null -w '%{http_code} %{http_connect}' --max-time 10 ${flags} ${url}; true`,
    ],
  });
  const [code = '000', connect = '000'] = (
    await runProgram(prepared.executable, prepared.arguments ?? [], {
      timeoutMs: 30_000,
    })
  ).split(' ');
  return code === '000' && connect !== '000' ? connect : code;
}
