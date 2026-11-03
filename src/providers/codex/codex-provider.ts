import { createHash } from 'node:crypto';
import { HOOK_TIMEOUT_SECONDS } from '../../approval/constants';
import { homedir } from 'node:os';

import {
  createSymlink,
  ensureDirectory,
  pathExists,
  writeText,
  join,
  goiabaCacheDir,
} from '../../filesystem/index';
import { UsageError } from '../../errors';
import { environment } from '../../execute/process';
import type { ProgramCommand, ProgramOutput } from '../../execute/types';
import { truncateError } from '../../logger/index';
import { log } from '../../logger/index';
import { delegatedCategories, type AgentPolicy } from '../../policy/index';
import { buildCodexPermissions, type CodexPermissions } from './permissions';
import type {
  Provider as ProviderContract,
  ProviderPermissions,
  UnsupportedRule,
} from '../provider.interface';
import { wrapCommand } from '../../workspace/sandbox/wrap-command';
import type {
  ExecutionGate,
  Provider,
  ProviderDescription,
  ProviderEvent,
  ProviderOptions,
  HostAccess,
} from '../types';

/** Long enough for a person to answer an approval prompt. */

/**
 * Codex logs every command our gate denies. The denial is already recorded
 * (database, log, approvals screen): the line goes to the debug log only.
 */
const GATE_DENIAL = /codex_core::tools::router: .*blocked by PreToolUse hook/;

export interface CodexProviderOptions extends ProviderOptions {
  /**
   * The user's Codex login (~/.codex/auth.json) reaches the CLI. Default
   * true; false for a model that needs none (Ollama), so it is not there.
   */
  readonly login?: boolean;
  /**
   * The interaction rules go with the first message of a session only (the
   * history keeps them), not with every one. Default false: every message.
   * A small model reads them, each time, as part of the request.
   */
  readonly rulesOnce?: boolean;
}

export class CodexProvider
  implements
    Provider<string, string>,
    ProviderContract<string, string, CodexPermissions>
{
  public readonly id = 'codex';

  private readonly executable: string;
  private readonly model: string;
  /** Uses the user's login (auth.json); off when the model is not OpenAI's. */
  private readonly login: boolean;
  private readonly rulesOnce: boolean;
  /** Per-workspace CODEX_HOME carrying the gate's hook, when gated. */
  private codexHome: string | undefined;
  private webSearchConfig: string | undefined;

  public constructor({
    executable = 'codex',
    model,
    login = true,
    rulesOnce = false,
  }: CodexProviderOptions) {
    if (model.trim().length === 0) {
      throw new Error('O modelo não pode estar vazio.');
    }

    this.executable = executable;
    this.model = model;
    this.login = login;
    this.rulesOnce = rulesOnce;
  }

  public describe(): ProviderDescription {
    return { name: 'codex', model: this.model };
  }

  /** Its state (sessions, config) and its login. */
  public hostAccess(): HostAccess {
    const home = homedir();
    return {
      state: [join(home, '.codex')],
      credentialFiles: this.login ? [join(home, '.codex/auth.json')] : [],
      credentialEnv: this.login ? ['OPENAI_API_KEY', 'CODEX_API_KEY'] : [],
    };
  }

  /** The OpenAI API, and ChatGPT for a ChatGPT login (and its token). */
  public networkEndpoints(): readonly string[] {
    return ['api.openai.com:443', 'chatgpt.com:443', 'auth.openai.com:443'];
  }

  /** The policy as Codex settings (`-c`) and command rules (`.rules`). */
  public buildPermissions(
    policy: AgentPolicy,
  ): ProviderPermissions<CodexPermissions> {
    return buildCodexPermissions(policy);
  }

  public applyPermissions(
    permissions: AgentPolicy,
    gate: ExecutionGate | undefined,
  ): readonly string[] {
    const categories = delegatedCategories(permissions);
    const unsupported = categories.find(
      (category) => category !== 'execution' && category !== 'web',
    );

    if (unsupported !== undefined) {
      throw new UsageError(
        `O provider ${this.id} ainda não aplica a categoria ${unsupported}.`,
      );
    }

    const translated = this.buildPermissions(permissions);
    refuseUnsupportedWeb(translated.unsupported);
    this.webSearchConfig = translated.native.config['tools.web_search'];

    if (gate === undefined) return [];

    const home = codexHomeFor(gate.root);
    const rules = join(home, 'rules');
    ensureDirectory(rules);
    const hooks = writeHooks(home, gate.hookCommand);
    if (this.login) linkCredentials(home);
    this.codexHome = home;

    // Read-only in the sandbox: the agent must not drop the hook or add rules.
    return [hooks, rules];
  }

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    const command = this.buildCommand(input, sessionId);

    return this.codexHome === undefined
      ? command
      : wrapCommand('env', [`CODEX_HOME=${this.codexHome}`], command);
  }

  private buildCommand(input: string, sessionId?: string): ProgramCommand {
    const commonArguments = [
      // The jail hides the parent repository; the sandbox is the boundary.
      '--skip-git-repo-check',
      '--json',
      '--model',
      this.model,
    ];
    // Exec-level flags: `resume` does not accept them after the subcommand.
    const execArguments = [
      // The whole CLI already runs inside Goiaba's sandbox (Docker/Bubblewrap),
      // which is the boundary: Codex's own sandbox would nest namespaces, and
      // its approval policy would reject the model's escalation requests.
      // Commands are still decided by Goiaba's PreToolUse hook.
      '--dangerously-bypass-approvals-and-sandbox',
      '--color',
      'never',
      // Only the model API: no usage metrics (ab.chatgpt.com), which under
      // network rules would each wait for an approval.
      '-c',
      'analytics.enabled=false',
      ...(this.webSearchConfig === undefined
        ? []
        : ['-c', `tools.web_search=${this.webSearchConfig}`]),
      // Our own hook in our own CODEX_HOME; there is no one to trust it.
      ...(this.codexHome === undefined
        ? []
        : ['--dangerously-bypass-hook-trust']),
    ];

    return {
      executable: this.executable,
      arguments:
        sessionId === undefined
          ? ['exec', ...execArguments, ...commonArguments, '-']
          : [
              'exec',
              ...execArguments,
              'resume',
              ...commonArguments,
              sessionId,
              '-',
            ],
      // The rules once per session where asked: the history keeps them.
      input:
        this.rulesOnce && sessionId !== undefined
          ? input
          : appendInteractionProtocol(input),
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    let stdout = '';
    const turn = new CodexTurn();

    for await (const { channel, chunk } of output) {
      if (channel === 'stderr') {
        const kept = withoutGateDenials(chunk);
        if (kept !== undefined) yield { type: 'output', value: kept };
        continue;
      }

      stdout += chunk;
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';

      for (const line of lines) {
        yield* readEvents(line, turn);
      }
    }

    if (stdout.length > 0) {
      yield* readEvents(stdout, turn);
    }
  }
}

class CodexTurn {
  private reasoning: string | undefined;
  private answered = false;

  public start(): void {
    this.reasoning = undefined;
    this.answered = false;
  }

  public rememberReasoning(text: string): void {
    this.reasoning = text;
  }

  public rememberAnswer(): void {
    this.answered = true;
  }

  public fallback(): string | undefined {
    if (this.answered) return undefined;
    return this.reasoning;
  }
}

/** Refuses web rules Codex would apply more loosely than the policy. */
function refuseUnsupportedWeb(unsupported: readonly UnsupportedRule[]): void {
  const web = unsupported.find(
    (rule) => rule.category === 'web' && rule.effect === 'looser',
  );
  if (web === undefined) return;
  throw new UsageError(
    `O provider codex não aplica esta regra web: ${web.reason}`,
  );
}

function createEvent(text: string): ProviderEvent<string> {
  if (text.trimEnd().endsWith('?')) {
    return { type: 'ask', question: text };
  }

  return { type: 'output', value: text };
}

function readEvents(
  line: string,
  turn: CodexTurn,
): readonly ProviderEvent<string>[] {
  if (line.trim().length === 0) {
    return [];
  }

  try {
    const event: unknown = JSON.parse(line);

    if (!isRecord(event)) {
      return [];
    }

    if (event['type'] === 'turn.started') {
      turn.start();
      return [];
    }

    if (event['type'] === 'turn.completed') {
      const fallback = turn.fallback();
      return fallback === undefined ? [] : [createEvent(fallback)];
    }

    if (
      event['type'] === 'thread.started' &&
      typeof event['thread_id'] === 'string'
    ) {
      return [{ type: 'session', id: event['thread_id'] }];
    }

    if (event['type'] !== 'item.completed') {
      return [];
    }

    const item = event['item'];

    if (!isRecord(item)) {
      return [];
    }

    if (item['type'] === 'command_execution') {
      const exitCode = item['exit_code'] ?? item['exitCode'];
      const call = {
        tool: 'shell',
        command: item['command'],
        cwd: item['cwd'],
        exitCode,
      };
      const events: ProviderEvent<string>[] = [
        { type: 'tool', phase: 'call', detail: call },
      ];

      if (typeof exitCode === 'number' && exitCode !== 0) {
        const output = item['aggregated_output'];
        events.push({
          type: 'tool',
          phase: 'error',
          detail: {
            provider: 'codex',
            ...call,
            message: truncateError(typeof output === 'string' ? output : ''),
          },
        });
      }

      const progress = commandProgress(item['command'], exitCode);
      return progress === undefined ? events : [...events, progress];
    }

    if (item['type'] === 'reasoning' && typeof item['text'] === 'string') {
      turn.rememberReasoning(item['text']);
      return [{ type: 'reasoning', text: item['text'] }];
    }

    if (item['type'] !== 'agent_message' || typeof item['text'] !== 'string') {
      return [];
    }

    turn.rememberAnswer();
    return [createEvent(item['text'])];
  } catch {
    return [createEvent(line)];
  }
}

/** Visible activity while the model is working; full details remain in debug. */
function commandProgress(
  command: unknown,
  exitCode: unknown,
): ProviderEvent<string> | undefined {
  if (typeof command !== 'string' || typeof exitCode !== 'number') {
    return undefined;
  }

  const firstLine = command.split('\n')[0]?.trim() ?? '';
  const summary =
    firstLine.length <= 140 ? firstLine : `${firstLine.slice(0, 139)}…`;
  return {
    type: 'output',
    value: `${exitCode === 0 ? '✓' : '✗'} ${summary}`,
  };
}

function appendInteractionProtocol(input: string): string {
  return `${input}\n\n${[
    'Regra de interação:',
    '- Nunca chame a ferramenta request_user_input.',
    '- Se precisar de uma informação do usuário, faça somente uma pergunta direta.',
    '- A pergunta deve terminar com "?".',
    '- Encerre o turno imediatamente após a pergunta e não continue a tarefa.',
    '- Quando receber a resposta no próximo turno, continue a tarefa normalmente.',
  ].join('\n')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A CODEX_HOME of our own: the hook cannot live in the user's ~/.codex, whose
 * rules and config could loosen the policy. Stable per workspace, so sessions
 * survive for `resume`.
 */
function codexHomeFor(root: string): string {
  const id = createHash('sha256').update(root).digest('hex').slice(0, 16);
  return join(goiabaCacheDir(environment()), 'codex', id);
}

/** Wires Codex's PreToolUse hook to the gate; returns the hooks.json path. */
function writeHooks(home: string, hookCommand: readonly string[]): string {
  const hooks = join(home, 'hooks.json');
  const hook = {
    type: 'command',
    command: shellJoin(hookCommand),
    timeout: HOOK_TIMEOUT_SECONDS,
  };

  writeText(
    hooks,
    `${JSON.stringify({
      hooks: { PreToolUse: [{ matcher: '^Bash$', hooks: [hook] }] },
    })}\n`,
    0o600,
  );
  return hooks;
}

/** Logged-in Codex keeps its credentials when CODEX_HOME is ours. */
function linkCredentials(home: string): void {
  const auth = join(homedir(), '.codex', 'auth.json');
  const link = join(home, 'auth.json');

  if (pathExists(auth) && !pathExists(link)) {
    createSymlink(auth, link);
  }
}

/** POSIX shell quoting for the hook command line. */
function shellJoin(argv: readonly string[]): string {
  return argv.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
}

/** `chunk` without the gate's denials; undefined when nothing else is left. */
function withoutGateDenials(chunk: string): string | undefined {
  const kept = chunk.split('\n').filter((line) => {
    const denial = GATE_DENIAL.test(line);
    if (denial) log.debug({ type: 'provider-noise', line });
    return !denial;
  });

  return kept.some((line) => line.trim().length > 0)
    ? kept.join('\n')
    : undefined;
}
