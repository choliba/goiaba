import { describe, expect, test } from 'bun:test';

import { createConsumer, type GoiabaEvent } from '../src/events/index';
import {
  NETWORK_SOURCE,
  NetworkBoundary,
  NetworkGate,
  decideByRules,
  networkRulesOf,
  type NetworkRequest,
  type NetworkRules,
} from '../src/network/index';
import type { AgentPolicy } from '../src/policy/index';
import { networkLedger, Store } from '../src/store/index';
import { Workspace } from '../src/workspace/index';

/** Where the store keeps this test's decisions and approvals. */
const where = { root: '/w', provider: 'claude' } as const;

const request = (hostname: string, port = 443): NetworkRequest => ({
  hostname,
  port,
  protocol: 'https',
});

test('a mesma porta não pode ser da sandbox (ports) e do host (localhost na política)', () => {
  const workspace = new Workspace({
    type: 'bubblewrap',
    root: process.cwd(),
    ports: [5173],
  });

  expect(() => {
    workspace.configureNetwork(
      new NetworkBoundary({
        rules: {
          default: 'deny',
          allow: [{ operations: ['connect'], hosts: ['localhost:5173'] }],
        },
        approve: () => Promise.resolve('deny'),
      }),
    );
  }).toThrow('A porta 5173 não pode estar em ports e em localhost:5173');
});

describe('regras de rede', () => {
  test('networkRulesOf tira da política só as listas network e o default', () => {
    // Uma política inteira, como um agente recebe.
    const policy: AgentPolicy = {
      default: 'deny',
      allow: {
        filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
        network: [{ operations: ['connect'], hosts: ['github.com'] }],
      },
      deny: { network: [{ operations: ['*'], hosts: ['169.254.169.254'] }] },
    };

    expect(networkRulesOf(policy)).toEqual({
      default: 'deny',
      allow: [{ operations: ['connect'], hosts: ['github.com'] }],
      requireApproval: [],
      deny: [{ operations: ['*'], hosts: ['169.254.169.254'] }],
    });
  });

  test('decideByRules: deny vence requireApproval, que vence allow; o resto é o default', () => {
    const rules: NetworkRules = {
      default: 'deny',
      allow: [{ operations: ['connect'], hosts: ['*.example.com'] }],
      requireApproval: [{ operations: ['connect'], hosts: ['a.example.com'] }],
      deny: [{ operations: ['connect'], hosts: ['a.example.com:22'] }],
    };
    const decide = (destination: string): string =>
      decideByRules(rules, destination).source;

    expect(decide('b.example.com:443')).toBe('allow');
    expect(decide('a.example.com:443')).toBe('requireApproval');
    expect(decide('a.example.com:22')).toBe('deny');
    expect(decide('outro.com:443')).toBe('default');
  });
});

describe('NetworkGate', () => {
  const rules: NetworkRules = {
    default: 'deny',
    allow: [{ operations: ['connect'], hosts: ['github.com'] }],
    requireApproval: [{ operations: ['connect'], hosts: ['npmjs.org'] }],
    deny: [{ operations: ['connect'], hosts: ['github.com:22'] }],
  };

  test('decide pela política: host e host:porta', async () => {
    const gate = new NetworkGate({
      rules,
      approve: () => Promise.reject(new Error('não deveria perguntar')),
    });

    expect((await gate.decide(request('github.com'))).decision).toBe('allow');
    expect((await gate.decide(request('github.com', 22))).decision).toBe(
      'deny',
    );
    expect((await gate.decide(request('exemplo.com'))).decision).toBe('deny');
  });

  test('host vale para toda porta; host:porta, inclusive no ignores, só para ela', async () => {
    const gate = new NetworkGate({
      rules: {
        default: 'deny',
        requireApproval: [
          {
            operations: ['connect'],
            hosts: ['*'],
            ignores: { hosts: ['www.google.com.br:443', 'localhost'] },
          },
        ],
      },
      approve: () => Promise.resolve('once'),
    });

    // Fora do requireApproval: cai no default, sem perguntar.
    expect(await gate.decide(request('www.google.com.br'))).toMatchObject({
      decision: 'deny',
    });
    // Outra porta do mesmo host continua no requireApproval.
    expect((await gate.decide(request('www.google.com.br', 80))).decision).toBe(
      'allow',
    );
    expect((await gate.decide(request('localhost', 3000))).decision).toBe(
      'deny',
    );
  });

  test('recusa URL no lugar de host', () => {
    expect(
      () =>
        new NetworkGate({
          rules: {
            default: 'deny',
            allow: [
              { operations: ['connect'], hosts: ['https://duckduckgo.com/'] },
            ],
          },
          approve: () => Promise.resolve('deny'),
        }),
    ).toThrow('Host inválido em allow.network: https://duckduckgo.com/');
  });

  test('nega sem perguntar o que o provider bloqueia', async () => {
    const store = Store.memory();
    const gate = new NetworkGate({
      ledger: networkLedger(store, where),
      rules: {
        default: 'deny',
        requireApproval: [{ operations: ['connect'], hosts: ['*'] }],
      },
      alwaysDeny: ['chatgpt.com:443'],
      approve: () => Promise.reject(new Error('não deveria perguntar')),
    });

    expect((await gate.decide(request('chatgpt.com'))).decision).toBe('deny');
    // Nem vira pedido pendente.
    expect(store.deniedDecisions('/w')).toEqual([]);
  });

  test('libera os endereços do provider mesmo com a política negando', async () => {
    const events: GoiabaEvent[] = [];
    const consumer = createConsumer((event) => events.push(event));
    consumer.subscribe(NETWORK_SOURCE);
    const gate = new NetworkGate({
      rules: { default: 'deny' },
      alwaysAllow: ['api.anthropic.com:443'],
      approve: () => Promise.resolve('deny'),
    });

    expect((await gate.decide(request('api.anthropic.com'))).decision).toBe(
      'allow',
    );
    expect((await gate.decide(request('api.anthropic.com', 80))).decision).toBe(
      'deny',
    );
    consumer.unsubscribeAll();
    expect(events.map((event) => [event.type, event['decidedBy']])).toEqual([
      ['decision', 'provider'],
      ['decision', 'default'],
    ]);
  });

  test('pergunta o que exige aprovação e lembra a aprovação da sessão', async () => {
    let asked = 0;
    const gate = new NetworkGate({
      rules,
      approve: () => {
        asked += 1;
        return Promise.resolve('session');
      },
    });

    expect((await gate.decide(request('npmjs.org'))).decision).toBe('allow');
    expect((await gate.decide(request('npmjs.org'))).decision).toBe('allow');
    expect(asked).toBe(1);
  });

  test('conexões simultâneas ao mesmo destino esperam a mesma resposta', async () => {
    let asked = 0;
    const answers: ((scope: 'once') => void)[] = [];
    const gate = new NetworkGate({
      rules,
      approve: () => {
        asked += 1;
        return new Promise((resolve) => {
          answers.push(resolve);
        });
      },
    });

    const first = gate.decide(request('npmjs.org'));
    const second = gate.decide(request('npmjs.org'));
    await Promise.resolve();
    for (const answer of answers) answer('once');

    expect((await first).decision).toBe('allow');
    expect((await second).decision).toBe('allow');
    expect(asked).toBe(1);
  });

  test('grava as decisões; a negação pelo default fica pendente e a aprovação vale depois', async () => {
    const store = Store.memory();
    const ledger = networkLedger(store, where);
    ledger.setSession('s1');
    const gate = new NetworkGate({
      ledger,
      rules,
      approve: () => Promise.resolve('deny'),
    });

    const denied = await gate.decide(request('exemplo.com'));
    expect(denied.reason).toContain('aguarda a aprovação de uma pessoa');

    const [pending] = store.deniedDecisions('/w');
    expect(pending).toMatchObject({
      command: 'exemplo.com:443',
      category: 'network',
      source: 'default',
      session: 's1',
    });

    store.saveApproval({
      root: '/w',
      pattern: 'exemplo.com:443',
      kind: 'once',
      category: 'network',
      session: 's1',
    });
    expect((await gate.decide(request('exemplo.com'))).decision).toBe('allow');
    // `once` foi usada: a próxima volta a ser negada.
    expect((await gate.decide(request('exemplo.com'))).decision).toBe('deny');
    // Uma aprovação de rede não vale como aprovação de comando.
    expect(store.activeApprovals('/w', 's1')).toEqual([]);
  });

  test('aprovar no workspace grava para as próximas execuções', async () => {
    const store = Store.memory();
    await new NetworkGate({
      ledger: networkLedger(store, where),
      rules,
      approve: () => Promise.resolve('workspace'),
    }).decide(request('npmjs.org'));

    const later = new NetworkGate({
      ledger: networkLedger(store, where),
      rules,
      approve: () => Promise.reject(new Error('não deveria perguntar')),
    });
    expect((await later.decide(request('npmjs.org'))).decision).toBe('allow');
  });
});

const dockerReady =
  Bun.which('docker') !== null &&
  Bun.spawnSync(['docker', 'image', 'inspect', 'oven/bun:latest']).exitCode ===
    0;

describe('NetworkBoundary', () => {
  for (const sandbox of ['bubblewrap', 'docker'] as const) {
    const available =
      sandbox === 'docker'
        ? dockerReady
        : Bun.which('bwrap') !== null && Bun.which('nsenter') !== null;

    test.skipIf(!available)(
      `${sandbox}: só sai pela rede através do proxy`,
      async () => {
        const server = Bun.serve({
          hostname: '127.0.0.2',
          port: 0,
          fetch: () => new Response('ok'),
        });
        const port = String(server.port);
        const workspace =
          sandbox === 'docker'
            ? new Workspace({
                type: 'docker',
                root: process.cwd(),
                image: 'FROM oven/bun:latest',
              })
            : new Workspace({ type: 'bubblewrap', root: process.cwd() });
        workspace.configureNetwork(
          new NetworkBoundary({
            rules: {
              default: 'deny',
              allow: [
                { operations: ['connect'], hosts: [`127.0.0.2:${port}`] },
              ],
            },
            approve: () => Promise.resolve('deny'),
          }),
        );

        const curl = async (...args: string[]): Promise<string> => {
          const prepared = await workspace.prepare({
            executable: 'curl',
            arguments: [
              '-s',
              '-o',
              '/dev/null',
              '-w',
              '%{http_code}',
              '--max-time',
              '3',
              ...args,
            ],
          });
          const child = Bun.spawn(
            [prepared.executable, ...(prepared.arguments ?? [])],
            {
              cwd: prepared.cwd ?? process.cwd(),
              stdin: 'ignore',
              stdout: 'pipe',
              stderr: 'ignore',
            },
          );
          const output = await new Response(child.stdout).text();
          await child.exited;
          return output;
        };

        try {
          // Liberado pela política, pelo proxy.
          expect(await curl(`http://127.0.0.2:${port}/`)).toBe('200');
          // Mesmo host, outra porta: o proxy nega.
          expect(await curl('http://127.0.0.2:1/')).toBe('403');
          // Ignorando o proxy: a sandbox não tem rede.
          expect(
            await curl('--noproxy', '*', `http://127.0.0.2:${port}/`),
          ).toBe('000');
        } finally {
          await workspace.close();
          await server.stop(true);
        }
      },
      30_000,
    );

    test.skipIf(!available)(
      `${sandbox}: localhost:<porta> na política leva à porta do host`,
      async () => {
        const server = Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          fetch: () => new Response('host'),
        });
        const port = String(server.port);
        const workspace =
          sandbox === 'docker'
            ? new Workspace({
                type: 'docker',
                root: process.cwd(),
                image: 'FROM oven/bun:latest',
              })
            : new Workspace({ type: 'bubblewrap', root: process.cwd() });
        workspace.configureNetwork(
          new NetworkBoundary({
            rules: {
              default: 'deny',
              allow: [
                { operations: ['connect'], hosts: [`localhost:${port}`] },
              ],
            },
            approve: () => Promise.resolve('deny'),
          }),
        );

        const curl = async (url: string): Promise<string> => {
          const prepared = await workspace.prepare({
            executable: 'curl',
            arguments: ['-s', '--max-time', '3', url],
          });
          const child = Bun.spawn(
            [prepared.executable, ...(prepared.arguments ?? [])],
            {
              cwd: prepared.cwd ?? process.cwd(),
              stdin: 'ignore',
              stdout: 'pipe',
              stderr: 'ignore',
            },
          );
          const output = await new Response(child.stdout).text();
          await child.exited;
          return output;
        };

        try {
          expect(await curl(`http://localhost:${port}/`)).toBe('host');
          expect(await curl(`http://127.0.0.1:${port}/`)).toBe('host');
        } finally {
          await workspace.close();
          await server.stop(true);
        }
      },
      30_000,
    );

    test.skipIf(!available)(
      `${sandbox}: ports abre no host a porta de um servidor da sandbox`,
      async () => {
        const free = Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          fetch: () => new Response(),
        });
        const port = free.port ?? 0;
        await free.stop(true);

        const options = { root: process.cwd(), ports: [port] };
        const workspace =
          sandbox === 'docker'
            ? new Workspace({
                ...options,
                type: 'docker',
                image: 'FROM oven/bun:latest',
              })
            : new Workspace({ ...options, type: 'bubblewrap' });
        workspace.configureNetwork(
          new NetworkBoundary({
            rules: {
              default: 'deny',
              deny: [{ operations: ['connect'], hosts: ['*'] }],
            },
            approve: () => Promise.resolve('deny'),
          }),
        );

        const prepared = await workspace.prepare({
          executable: process.execPath,
          arguments: [
            '-e',
            `Bun.serve({ hostname: '127.0.0.1', port: ${String(port)}, fetch: () => new Response('dentro') }); await Bun.sleep(8000);`,
          ],
        });
        const child = Bun.spawn(
          [prepared.executable, ...(prepared.arguments ?? [])],
          {
            cwd: prepared.cwd ?? process.cwd(),
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'ignore',
          },
        );

        try {
          let body = '';
          for (
            let attempt = 0;
            attempt < 50 && body !== 'dentro';
            attempt += 1
          ) {
            await Bun.sleep(100);
            body = await fetch(`http://127.0.0.1:${String(port)}/`)
              .then((response) => response.text())
              .catch(() => '');
          }
          expect(body).toBe('dentro');
        } finally {
          child.kill();
          await child.exited;
          await workspace.close();
        }
      },
      30_000,
    );
  }
});
