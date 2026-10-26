import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  ApprovalBroker,
  suggestPattern,
  type CommandApprovalRequest,
} from '../src/approval/broker';
import { ApprovalReview } from '../src/approval/review';
import type { AgentPolicy } from '../src/policy/index';
import type { ApprovalScope } from '../src/store/index';
import { Store } from '../src/store/index';
import { Workspace } from '../src/workspace/index';

const permissions: AgentPolicy = {
  default: 'deny',
  allow: { execution: [{ commands: ['mkdir *', 'ls *', 'cd *'] }] },
  requireApproval: { execution: [{ commands: ['touch *', 'rm *'] }] },
  deny: { execution: [{ commands: ['sudo *'] }] },
};

let cache: string;
let previousCache: string | undefined;

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), 'goiaba-gate-'));
  previousCache = process.env['XDG_CACHE_HOME'];
  process.env['XDG_CACHE_HOME'] = cache;
});

afterEach(() => {
  if (previousCache === undefined) delete process.env['XDG_CACHE_HOME'];
  else process.env['XDG_CACHE_HOME'] = previousCache;
  rmSync(cache, { recursive: true, force: true });
});

function broker(
  answers: ApprovalScope[],
  store = Store.memory(),
): { broker: ApprovalBroker; asked: CommandApprovalRequest[]; store: Store } {
  const asked: CommandApprovalRequest[] = [];
  return {
    asked,
    store,
    broker: new ApprovalBroker({
      permissions,
      provider: 'claude',
      root: '/w',
      store,
      approve: (request) => {
        asked.push(request);
        return Promise.resolve(answers.shift() ?? 'deny');
      },
    }),
  };
}

async function runHook(
  gate: ApprovalBroker,
  input: unknown,
): Promise<{ code: number | null; stdout: string }> {
  const [runtime = '', ...args] = gate.hookCommand();
  const child = spawn(runtime, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stdin.end(JSON.stringify(input));
  const code = await new Promise<number | null>((resolve) => {
    child.on('close', resolve);
  });
  return { code, stdout };
}

describe('ApprovalBroker', () => {
  test('a política decide sozinha allow e deny; o resto pergunta', async () => {
    const { broker: gate, asked } = broker(['once', 'deny']);

    expect((await gate.decide('mkdir -p /w/a')).decision).toBe('allow');
    expect((await gate.decide('sudo id')).decision).toBe('deny');
    expect((await gate.decide('touch /w/a/b')).decision).toBe('allow');
    expect((await gate.decide('touch /w/a/c')).decision).toBe('deny');
    expect(asked.map((request) => request.command)).toEqual([
      'touch /w/a/b',
      'touch /w/a/c',
    ]);
    await gate.close();
  });

  test('sessão e workspace salvam o padrão; workspace sobrevive ao broker', async () => {
    const store = Store.memory();
    const first = broker(['session', 'workspace'], store);

    await first.broker.decide('touch a');
    expect((await first.broker.decide('touch b')).decision).toBe('allow');
    await first.broker.decide('rm -rf build');
    await first.broker.close();

    const second = broker([], store);
    expect((await second.broker.decide('rm -rf dist')).decision).toBe('allow');
    expect((await second.broker.decide('touch c')).decision).toBe('deny');
    expect(second.asked.map((request) => request.command)).toEqual(['touch c']);
    await second.broker.close();
  });

  test('aprovação salva não cobre composição com partes não aprovadas', async () => {
    const { broker: gate, asked } = broker(['workspace', 'deny']);

    await gate.decide('rm a');
    expect((await gate.decide('cd /w && rm b')).decision).toBe('allow');
    expect((await gate.decide('rm c > out.txt')).decision).toBe('deny');
    expect(asked).toHaveLength(2);
    await gate.close();
  });

  test('aprovação salva vale contra o default, nunca contra um deny explícito', async () => {
    const store = Store.memory();
    store.saveApproval({
      root: '/w',
      pattern: 'cat a | head -5',
      kind: 'once',
    });
    store.saveApproval({ root: '/w', pattern: 'sudo *', kind: 'workspace' });
    store.saveApproval({ root: '/w', pattern: 'node *', kind: 'workspace' });
    const { broker: gate } = broker([], store);

    // `cat`/`head` are in no rule: the default denies, the approval allows.
    expect((await gate.decide('cat a | head -5')).decision).toBe('allow');
    expect((await gate.decide('cat a | head -5')).decision).toBe('deny');
    expect((await gate.decide('node --version')).decision).toBe('allow');
    // `sudo` is denied by a rule: no approval overrides it.
    expect((await gate.decide('sudo id')).decision).toBe('deny');
    expect((await gate.decide('node x && sudo id')).decision).toBe('deny');
    await gate.close();
  });

  test('negação por deny explícito não fica pendente; a do default fica', async () => {
    const { broker: gate, store } = broker([]);

    await gate.decide('sudo id');
    await gate.decide('node --version');

    expect(
      store.deniedDecisions('/w').map((d) => [d.command, d.source]),
    ).toEqual([['node --version', 'default']]);
    await gate.close();
  });

  test('grava toda decisão no store', async () => {
    const { broker: gate, store } = broker(['deny']);

    await gate.decide('mkdir x');
    await gate.decide('touch y');

    expect(
      store.deniedDecisions('/w').map((d) => [d.command, d.source]),
    ).toEqual([['touch y', 'human']]);
    await gate.close();
  });

  test('sugere padrão só para comando simples', () => {
    expect(suggestPattern('mkdir -p src/pages')).toBe('mkdir *');
    expect(suggestPattern('cd a && rm b')).toBe('cd a && rm b');
    expect(suggestPattern('cat > a')).toBe('cat > a');
    expect(suggestPattern('pwd')).toBe('pwd');
  });
});

describe('limpeza de gates abandonados', () => {
  test('apaga gates de processos mortos e mantém os vivos', async () => {
    const gates = join(cache, 'goiaba', 'gate');
    const make = (name: string, owner?: string): string => {
      const dir = join(gates, name);
      mkdirSync(dir, { recursive: true });
      if (owner !== undefined) writeFileSync(join(dir, 'owner.pid'), owner);
      return dir;
    };
    const dead = make('morto', '999999999');
    const alive = make('vivo', String(process.pid));
    const fresh = make('sem-dono');

    const { broker: gate } = broker([]);

    expect(existsSync(dead)).toBe(false);
    expect(existsSync(alive)).toBe(true);
    // Without an owner but just created: maybe a run starting right now.
    expect(existsSync(fresh)).toBe(true);
    await gate.close();
  });
});

describe('hook do gate', () => {
  test('responde no formato PreToolUse com a decisão do broker', async () => {
    const { broker: gate } = broker([]);
    await gate.start();

    try {
      const allowed = await runHook(gate, {
        tool_name: 'Bash',
        tool_input: { command: 'mkdir x' },
      });
      const denied = await runHook(gate, {
        tool_name: 'Bash',
        tool_input: { command: 'sudo id' },
      });

      expect(allowed.code).toBe(0);
      expect(JSON.parse(allowed.stdout)).toMatchObject({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
        },
      });
      expect(denied.code).toBe(0);
      expect(JSON.parse(denied.stdout)).toMatchObject({
        hookSpecificOutput: { permissionDecision: 'deny' },
      });
    } finally {
      await gate.close();
    }
  });

  test('sem broker falha fechado: deny e saída 2', async () => {
    const { broker: gate } = broker([]);
    await gate.start();
    await gate.close();
    // The bundle is gone with the gate dir; rebuild to run the hook alone.
    const { broker: other } = broker([]);
    await other.start();
    const hookCommand = [...other.hookCommand()];
    hookCommand[2] = join(cache, 'nao-existe.sock');

    try {
      const [runtime = '', ...args] = hookCommand;
      const child = spawn(runtime, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stdin.end(
        JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
      );
      const code = await new Promise<number | null>((resolve) => {
        child.on('close', resolve);
      });

      expect(code).toBe(2);
      expect(JSON.parse(stdout)).toMatchObject({
        hookSpecificOutput: { permissionDecision: 'deny' },
      });
    } finally {
      await other.close();
    }
  });
});

describe('Store', () => {
  test('retoma só a mesma tarefa interrompida ou com aprovação nova', () => {
    const store = Store.memory();
    const session = (id: string, prompt = 'tarefa'): void => {
      store.recordSession({ id, provider: 'claude', root: '/w', prompt });
    };

    session('s1');
    expect(store.resumableSession('claude', '/w', 'tarefa')).toBe('s1');
    expect(store.resumableSession('claude', '/w', 'outra')).toBeUndefined();
    expect(store.resumableSession('codex', '/w', 'tarefa')).toBeUndefined();

    store.finishSession('s1');
    expect(store.resumableSession('claude', '/w', 'tarefa')).toBeUndefined();

    store.saveApproval({
      root: '/w',
      pattern: 'ls',
      kind: 'once',
      session: 's1',
    });
    expect(store.resumableSession('claude', '/w', 'tarefa')).toBe('s1');
  });

  test('sessão nova abandona as abertas e some com as negações delas', () => {
    const store = Store.memory();
    const open = (id: string, provider = 'claude'): void => {
      store.recordSession({ id, provider, root: '/w', prompt: 'p' });
    };
    open('antiga');
    open('de-outro-provider', 'codex');
    store.recordDecision({
      session: 'antiga',
      provider: 'claude',
      root: '/w',
      command: 'rm x',
      decision: 'deny',
      source: 'default',
      reason: 'x',
    });
    expect(store.deniedDecisions('/w')).toHaveLength(1);

    open('nova');
    store.abandonOtherSessions('claude', '/w', 'nova');

    expect(store.deniedDecisions('/w')).toEqual([]);
    expect(store.resumableSession('claude', '/w', 'p')).toBe('nova');
    expect(store.resumableSession('codex', '/w', 'p')).toBe(
      'de-outro-provider',
    );
  });

  test('avisos pendentes até serem marcados', () => {
    const store = Store.memory();
    store.saveApproval({
      root: '/w',
      pattern: 'mkdir -p x',
      kind: 'once',
      session: 's1',
    });
    store.saveApproval({ root: '/w', pattern: 'npm *', kind: 'workspace' });

    const notices = store.pendingNotices('/w', 's1');
    expect(notices.map((notice) => notice.pattern)).toEqual([
      'mkdir -p x',
      'npm *',
    ]);
    store.markNotified(notices.map((notice) => notice.id));
    expect(store.pendingNotices('/w', 's1')).toEqual([]);
  });
});

describe('proteção na sandbox', () => {
  test.skipIf(Bun.which('bwrap') === null || Bun.which('nsenter') === null)(
    'caminho protegido fica só leitura dentro da jaula',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'goiaba-protect-ws-'));
      const state = join(cache, 'goiaba', 'protegido');
      mkdirSync(state, { recursive: true });
      writeFileSync(join(state, 'hook'), 'original');
      const workspace = new Workspace({ type: 'bubblewrap', root });
      workspace.protect([state]);

      try {
        const prepared = await workspace.prepare({
          executable: '/bin/sh',
          arguments: [
            '-c',
            `echo trocado > ${join(state, 'hook')}; echo livre > ${join(cache, 'livre.txt')}`,
          ],
        });
        const child = spawn(
          prepared.executable,
          [...(prepared.arguments ?? [])],
          {
            cwd: prepared.cwd,
          },
        );
        await new Promise((resolve) => {
          child.on('close', resolve);
        });

        expect(readFileSync(join(state, 'hook'), 'utf8')).toBe('original');
        expect(readFileSync(join(cache, 'livre.txt'), 'utf8')).toBe('livre\n');
      } finally {
        await workspace.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

/** A default denial of `command` in `session`. */
function deny(session: string, command = 'cd .. && ls -la') {
  return {
    session,
    provider: 'ollama-codex',
    root: '/w',
    command,
    decision: 'deny' as const,
    source: 'default' as const,
    reason: 'x',
  };
}

describe('negações repetidas', () => {
  test('o mesmo pedido pendente conta tentativas na mesma linha', () => {
    const store = Store.memory();
    const first = store.recordDecision(deny('s1'));
    expect(store.recordDecision(deny('s1'))).toBe(first);
    expect(store.recordDecision(deny('s1'))).toBe(first);
    // Another session or command is another request.
    store.recordDecision(deny('s2'));
    store.recordDecision(deny('s1', 'rm x'));

    const pending = store.deniedDecisions('/w');
    expect(pending).toHaveLength(3);
    expect(pending.find((decision) => decision.id === first)).toMatchObject({
      attempts: 3,
      session: 's1',
    });
  });

  test('depois de aprovado, negar de novo é um pedido novo', () => {
    const store = Store.memory();
    const first = store.recordDecision(deny('s1'));
    store.saveApproval({
      root: '/w',
      pattern: 'cd .. && ls -la',
      kind: 'once',
      session: 's1',
      decisionId: first,
    });

    expect(store.recordDecision(deny('s1'))).not.toBe(first);
  });

  test('o agente lê que deve esperar, com o número do pedido', async () => {
    const { broker: gate, store } = broker([]);
    gate.setSession('s1');

    const first = await gate.decide('cat /etc/hosts');
    const again = await gate.decide('cat /etc/hosts');
    const pending = store.deniedDecisions('/w').at(0);

    expect(first.decision).toBe('deny');
    expect(first.reason).toContain(`pedido #${String(pending?.id)}`);
    expect(first.reason).toContain('Não repita este comando');
    expect(again.reason).toBe(first.reason);
    expect(pending?.attempts).toBe(2);
  });

  test('linhas repetidas de antes viram uma, com as tentativas somadas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'goiaba-store-'));
    const path = join(dir, 'antigo.db');

    try {
      // A database from before `attempts`: one row per attempt.
      const old = new Database(path);
      old.run(`CREATE TABLE decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, session TEXT,
        provider TEXT NOT NULL, root TEXT NOT NULL, command TEXT NOT NULL,
        decision TEXT NOT NULL, source TEXT NOT NULL, scope TEXT,
        reason TEXT NOT NULL)`);
      for (const ts of ['2026-10-26T16:00:01Z', '2026-10-26T16:00:09Z']) {
        old
          .query(
            `INSERT INTO decisions (ts, session, provider, root, command, decision, source, reason)
             VALUES (?, 's1', 'codex', '/w', 'cd ..', 'deny', 'default', 'x')`,
          )
          .run(ts);
      }
      old.close();

      const store = Store.open(path);
      const pending = store.deniedDecisions('/w');
      store.close();

      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        attempts: 2,
        ts: '2026-10-26T16:00:09Z',
        lastTs: '2026-10-26T16:00:09Z',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('descartar pedidos pendentes', () => {
  test('descartado deixa de ser pendente, e tentar de novo é um pedido novo', () => {
    const store = Store.memory();
    const first = store.recordDecision(deny('s1'));

    store.dismissDecision(first);

    expect(store.deniedDecisions('/w')).toEqual([]);
    const again = store.recordDecision(deny('s1'));
    expect(again).not.toBe(first);
    expect(store.deniedDecisions('/w').map((decision) => decision.id)).toEqual([
      again,
    ]);
  });

  test('na tela: marcar, avançar e descartar com d', async () => {
    const store = Store.memory();
    const kept = store.recordDecision(deny('s1', 'npm run build'));
    const dropped = store.recordDecision(deny('s1', 'cd .. && ls -la'));
    const written: string[] = [];
    // The table lists the newest first: 1 is the second request.
    const answers = ['1', 'r'];

    await new ApprovalReview(store, {
      ask: () => Promise.resolve(answers.shift() ?? 'q'),
      choose: () => Promise.resolve('d'),
      write: (value) => written.push(value),
    }).run('/w');

    expect(store.deniedDecisions('/w').map((decision) => decision.id)).toEqual([
      kept,
    ]);
    expect(written.join('\n')).toContain(
      `✖ Descartado (#${String(dropped)}): cd .. && ls -la`,
    );
    expect(written.join('\n')).toContain('[d] descartar');
  });
});
