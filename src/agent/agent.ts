import { randomUUID } from 'node:crypto';

import type {
  AgentAsk,
  AgentOptions,
  AgentProvider,
  AgentStatus,
  AgentSubscriber,
} from './types';
import { ApprovalBroker } from '../approval/broker';
import type { CommandApprover } from '../approval/gate';
import { humanApprover } from '../approval/human';
import { ApprovalReview } from '../approval/review';
import { WorkspaceLock } from './lock';
import { AgentOutput } from './output';
import { getConfig, isConfigLoaded } from '../config/index';
import { Executor, ProgramExecutionError } from '../execute/index';
import { createConsumer, createProducer } from '../events/index';
import {
  closeLogger,
  isDebug,
  isLoggerOpen,
  log,
  openLogger,
  type LogInput,
} from '../logger/index';
import { asAgent, currentRun, type AgentScope } from '../scope/index';
import type { AgentEvent, ExecutionGate, ToolEvent } from '../providers/types';
import { Store, type StoredApproval } from '../store/index';
import {
  delegatedCategories,
  PolicyEngine,
  type AgentPolicy,
  type PolicyCategory,
} from '../policy/index';
import { UsageError } from '../errors';
import { StandardOutput, type OutputAdapter } from '../output/index';
import { listenForInterrupt } from '../execute/interrupt';
import { scriptSignal } from '../usage';
import type { Workspace } from '../workspace/index';
import { currentProcessCommand, environment } from '../execute/process';
import { sandboxHost } from '../workspace/sandbox/host-access';
import { NetworkBoundary, type NetworkApprovalRequest } from '../network/index';

export class Agent {
  /** Identifies the agent in its events, logs and sessions. */
  public readonly name: string;
  public readonly prompt: string;

  public readonly provider: AgentProvider;
  private readonly executor: Executor;
  public readonly workspace: Workspace;
  private readonly output: OutputAdapter;
  private readonly signal: AbortSignal | undefined;
  /** Ctrl+C while it runs, when nobody gave it a signal (no runScript). */
  private interrupted: AbortSignal | undefined;
  private readonly store: Store | undefined;
  private readonly broker: ApprovalBroker | undefined;
  private readonly network: NetworkBoundary | undefined;
  /** One running agent per workspace, across programs. */
  private readonly lock: WorkspaceLock;
  /** A session to continue on the next run (resume(), GOIABA_RESUME_SESSION). */
  private forced: string | undefined;
  private readonly conversation: boolean;
  private readonly permissions: AgentPolicy | undefined;
  private readonly subscribers: readonly AgentSubscriber[];
  /** What the agent said while the approvals screen was open; shown after. */
  private held: string[] | undefined;
  /** The status line it should show now (`pensando`, `rodando`…). */
  private wantedStatus: string | undefined;
  /** Approvals being asked right now: the CLI waits on them, it is not silent. */
  private approving = 0;
  private state: AgentStatus = 'idle';
  /** The run in progress; `run()` while running returns it. */
  private current: Promise<void> | undefined;
  /** Stops the run in progress (pause, stop). */
  private controller: AbortController | undefined;
  /** Pausing: the run ends but the sandbox and the gate stay open. */
  private keepOpen = false;

  public constructor({
    name,
    prompt,
    provider,
    workspace,
    executor,
    output,
    interaction = new StandardOutput(),
    permissions,
    signal = scriptSignal(),
    approve,
    store,
    conversation = true,
    subscribe = [],
  }: AgentOptions) {
    if (name.trim().length === 0) {
      throw new Error('O nome do agente não pode estar vazio.');
    }

    if (prompt.trim().length === 0) {
      throw new Error('O prompt do agente não pode estar vazio.');
    }

    if (executor !== undefined && output !== undefined) {
      throw new Error('Informe executor ou output, não ambos.');
    }

    this.prompt = prompt;
    this.name = name;
    this.provider = provider;
    this.workspace = workspace;
    this.lock = new WorkspaceLock(workspace.root, name);
    this.executor =
      executor ?? new Executor(output === undefined ? {} : { output });
    this.output = interaction;
    this.signal = signal;
    this.conversation = conversation;
    this.permissions = permissions;
    this.subscribers = subscribe;
    // Forces one session (e.g. relaunched by `approvals`); otherwise the store
    // decides whether to continue (see `resumableSession`).
    this.forced = forcedSession();
    this.store = store ?? defaultStore();
    const enforced =
      permissions === undefined
        ? undefined
        : enforcePermissions({
            permissions,
            provider,
            workspace,
            approve: this.whileApproving(
              approve ?? humanApprover(interaction, signal),
            ),
            store: this.store,
          });
    this.broker = enforced?.broker;
    this.network = enforced?.network;
    shareHost(workspace, provider, permissions);
  }

  /**
   * While a question is open the CLI is waiting for the person, not
   * thinking: no `pensando` over the prompt meanwhile.
   */
  private whileApproving(approve: CommandApprover): CommandApprover {
    return async (request) => {
      this.approving += 1;
      try {
        return await approve(request);
      } finally {
        this.approving -= 1;
        this.renderStatus();
      }
    };
  }

  /** idle, running, paused, stopped or destroyed. */
  public status(): AgentStatus {
    return this.state;
  }

  /**
   * Starts the conversation; while it runs, returns the run in progress. An
   * interrupted task of the same prompt is continued automatically.
   */
  public run(): Promise<void> {
    this.assertUsable();
    return this.current ?? this.start();
  }

  /**
   * Interrupts the current turn and keeps the sandbox and the gate open;
   * `run()` continues it.
   */
  public async pause(): Promise<void> {
    if (this.current === undefined) return;

    this.keepOpen = true;
    this.state = 'paused';
    await this.interrupt();
  }

  /**
   * Ends the run and closes the sandbox and the gate; the session stays open
   * in the database, and the next `run()` continues it.
   */
  public async stop(): Promise<void> {
    if (this.current !== undefined) {
      this.state = 'stopped';
      await this.interrupt();
      return;
    }

    if (this.state === 'paused') {
      await this.closeResources();
      this.state = 'stopped';
    }
  }

  /** Stops and drops the open sessions: the next run starts from scratch. */
  public async reset(): Promise<void> {
    this.assertUsable();
    await this.stop();
    this.store?.abandonOtherSessions(this.provider.id, this.workspace.root, '');
    this.forced = undefined;
    this.state = 'idle';
  }

  /**
   * Stops, ends the open sessions and releases everything: the agent cannot
   * be used again, and the next run of it starts from scratch.
   */
  public async destroy(): Promise<void> {
    if (this.state === 'destroyed') return;

    await this.stop();
    this.store?.abandonOtherSessions(this.provider.id, this.workspace.root, '');
    this.store?.close();
    this.state = 'destroyed';
  }

  private start(): Promise<void> {
    this.controller = new AbortController();
    this.state = 'running';
    // Without a signal (an agent file without runScript), Ctrl+C is its own.
    const interrupt =
      this.signal === undefined ? listenForInterrupt() : undefined;
    this.interrupted = interrupt?.signal;
    // Deferred so `current` is set before the first report: a subscriber
    // calling `run()` gets this run instead of starting another.
    const run = Promise.resolve()
      .then(() => asAgent(this.scope(), () => this.runConversation()))
      .finally(() => {
        interrupt?.dispose();
        this.current = undefined;
        this.controller = undefined;
        // Interrupted from outside (Ctrl+C): stopped, the session stays open.
        if (this.state === 'running') {
          this.state =
            this.outerSignal()?.aborted === true ? 'stopped' : 'idle';
        }
      });
    this.current = run;
    return run;
  }

  private async interrupt(): Promise<void> {
    const run = this.current;
    this.controller?.abort();
    try {
      await run;
    } catch {
      // The run reports its own failure.
    } finally {
      this.keepOpen = false;
    }
  }

  /** Who reports: this agent and the provider, model and CLI it runs on. */
  private scope(): AgentScope {
    const provider = this.provider.describe?.();
    return provider === undefined
      ? { name: this.name }
      : { name: this.name, provider };
  }

  /** The whole configuration this agent runs with; secrets are masked by the log. */
  private configuration(): Record<string, unknown> {
    const config = isConfigLoaded() ? getConfig() : undefined;

    return {
      name: this.name,
      prompt: this.prompt,
      provider: this.provider.describe?.() ?? { name: this.provider.id },
      workspace: this.workspace.options,
      permissions: this.permissions ?? null,
      gate: this.broker !== undefined,
      conversation: this.conversation,
      subscribers: this.subscribers.length,
      goiaba:
        config === undefined
          ? null
          : {
              configPath: config.configPath ?? null,
              debug: config.debug,
              logger: {
                dir: config.logger.dir,
                use: config.logger.use !== undefined,
              },
              databasePath: config.databasePath,
              env: config.env?.vars ?? {},
            },
    };
  }

  private assertUsable(): void {
    if (this.state === 'destroyed') {
      throw new UsageError(`O agente ${this.name} foi destruído.`);
    }
  }

  /** Who stops it from outside: the given signal, or its own Ctrl+C. */
  private outerSignal(): AbortSignal | undefined {
    return this.signal ?? this.interrupted;
  }

  /** The external signal (Ctrl+C) or this run's own (pause, stop). */
  private runSignal(): AbortSignal | undefined {
    return anySignal(this.outerSignal(), this.controller?.signal);
  }

  private takeForcedSession(): string | undefined {
    const session = this.forced;
    this.forced = undefined;
    return session;
  }

  private async closeResources(): Promise<void> {
    await this.broker?.close();
    await this.workspace.close();
    this.lock.release();
  }

  private async runConversation(): Promise<void> {
    try {
      const answer: AgentAsk = (question, signal) =>
        this.output.ask(question, anySignal(this.runSignal(), signal));
      const listen = this.output.listen?.bind(this.output);

      for await (const event of this.interact(this.prompt, answer, listen)) {
        if (event.type === 'output') {
          this.say(event.value);
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        this.show('\n');
        return;
      }

      if (
        error instanceof UsageError ||
        error instanceof ProgramExecutionError
      ) {
        this.show(error.message);
        return;
      }

      throw error;
    }
  }

  /**
   * The conversation, run as this agent: everything reported on the way
   * (commands, sandbox, tools, decisions…) carries `agent: name`.
   */
  private async *interact(
    input: string,
    answer: AgentAsk,
    listen?: (signal?: AbortSignal) => Promise<string>,
  ): AsyncIterable<AgentEvent<string>> {
    const turns = this.converse(input, answer, listen)[Symbol.asyncIterator]();
    // One run for the whole conversation, also when called outside `run()`.
    const run = currentRun(this.name) ?? randomUUID();

    for (;;) {
      const next = await asAgent(this.scope(), () => turns.next(), run);
      if (next.done === true) return;
      yield next.value;
    }
  }

  private async *converse(
    input: string,
    answer: AgentAsk,
    listen?: (signal?: AbortSignal) => Promise<string>,
  ): AsyncIterable<AgentEvent<string>> {
    // runScript owns the log of the whole script; outside it, the agent does.
    const ownsLogger = !isLoggerOpen();
    if (ownsLogger) openLogger();
    // The subscribers hear everything this agent reports, not other agents'.
    const subscribers = createConsumer((event) => {
      if (event.agent !== this.name) return;
      const output = new AgentOutput(event, this);
      for (const subscriber of this.subscribers) subscriber(output);
    });
    subscribers.subscribe(AGENT_SOURCE);
    // With debug, everything this run uses, so the log says how it ran.
    if (isDebug()) {
      log.debug({ type: 'agent_config', config: this.configuration() });
    }
    publish({ type: 'input', value: input });

    let nextInput = input;
    let sessionId: string | undefined;
    /** The stored session this run tries to continue, until the CLI confirms it. */
    let resuming: string | undefined;

    try {
      // Before the sandbox and the gate: another run here would only wait.
      this.lock.acquire();
      await this.broker?.start();
      sessionId = this.resumedSession(input);

      if (sessionId !== undefined) {
        this.broker?.setSession(sessionId);
        this.network?.setSession(sessionId);
        // The task is already in the session's history: only what changed.
        nextInput = this.continuation(sessionId);
        publish({ type: 'resume', session: sessionId, input: nextInput });
        resuming = sessionId;
      }

      while (true) {
        let pendingAnswer: Promise<string> | undefined;
        const question = new AbortController();
        const typed = listenInput(
          listen,
          anySignal(this.runSignal(), question.signal),
          (value) => this.dispatchLiveInput(value, sessionId),
        );

        // The loop runs while the CLI does (it ends when the process exits).
        // While the model works: one line on screen when it starts, and
        // every phase (start, ticks, end) for the subscribers.
        const thinking = watchThinking(
          (phase, seconds) => {
            if (phase === 'start') this.setStatus(THINKING_MESSAGE);
            if (phase === 'end') this.setStatus(undefined);
            const record = { type: 'thinking', phase, seconds };
            // A tick is a clock, not something that happened: not logged.
            if (phase === 'tick') agentEvents.emit(record);
            else publish(record, 'debug');
          },
          { paused: () => this.approving > 0 },
        );

        try {
          for await (const event of this.executor.run(
            this.provider,
            this.workspace,
            nextInput,
            sessionId,
            this.runSignal(),
          )) {
            if (event.type === 'session') {
              resuming = undefined;
              // A brand-new session replaces the open ones it cannot resume.
              if (sessionId === undefined) {
                this.store?.abandonOtherSessions(
                  this.provider.id,
                  this.workspace.root,
                  event.id,
                );
              }
              sessionId = event.id;
              this.broker?.setSession(event.id);
              this.network?.setSession(event.id);
              this.store?.recordSession({
                id: event.id,
                provider: this.provider.id,
                root: this.workspace.root,
                prompt: input,
                agent: this.name,
                command: currentProcessCommand(),
              });
              publish({ type: 'session', id: event.id });
              continue;
            }

            if (event.type === 'tool') {
              // Reaches the log, not the conversation.
              logTool(event);
              // On screen: a tool running, then back to the model.
              this.setStatus(
                event.phase === 'call' ? BACKGROUND_MESSAGE : THINKING_MESSAGE,
              );
              continue;
            }
            publish({ ...event });
            thinking.spoke();

            if (event.type === 'ask') {
              yield { type: 'output', value: event.question };
            }

            yield event;

            if (event.type === 'ask' && pendingAnswer === undefined) {
              pendingAnswer =
                typed?.promise ?? answer(event.question, question.signal);
              // Keep the rejection handled until this turn finishes and awaits it.
              void pendingAnswer.catch(() => undefined);
            }
          }
        } catch (error) {
          // The CLI no longer has the stored session (its history is gone):
          // start the task over in a new one instead of failing.
          if (
            resuming === undefined ||
            !(error instanceof ProgramExecutionError)
          ) {
            throw error;
          }
          typed?.cancel();
          question.abort();
          this.show(FORGOTTEN_SESSION_MESSAGE);
          publish({ type: 'resume_failed', session: resuming }, 'error');
          this.store?.abandonOtherSessions(
            this.provider.id,
            this.workspace.root,
            '',
          );
          resuming = undefined;
          sessionId = undefined;
          nextInput = input;
          continue;
        } finally {
          thinking.stop();
        }

        const waiting =
          sessionId === undefined ? 0 : this.pendingDenials(sessionId);

        pendingAnswer ??= typed?.submitted();

        // A conversation never ends on its own: wait for the next message.
        if (pendingAnswer === undefined && this.conversation) {
          pendingAnswer = typed?.promise ?? answer('', question.signal);
        }

        if (pendingAnswer === undefined && waiting > 0) {
          pendingAnswer = typed?.promise;
        }

        if (pendingAnswer === undefined && waiting === 0) {
          typed?.cancel();
          // Ended on its own (not interrupted): the next run starts over.
          if (sessionId !== undefined) this.store?.finishSession(sessionId);
          return;
        }

        if (sessionId === undefined) {
          throw new Error('O provider não informou o identificador da sessão.');
        }

        if (waiting > 0)
          yield { type: 'output', value: waitingMessage(waiting) };

        const next = await this.nextTurn(sessionId, pendingAnswer, waiting > 0);
        question.abort();
        const resolved = await this.resolveLocalInput(sessionId, next, listen);
        nextInput = resolved.input;
        const turn = {
          type: resolved.approved ? 'approved' : 'answer',
          value: nextInput,
        } as const;
        publish(turn);
      }
    } catch (error) {
      if (!isAbortError(error)) {
        log.failure(error);
        agentEvents.emit({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }

      throw error;
    } finally {
      if (ownsLogger) closeLogger();
      // Paused: the sandbox and the gate wait for resume().
      if (!this.keepOpen) await this.closeResources();
      // Releases the terminal; it is taken again on the next run.
      this.output.close?.();
      subscribers.unsubscribeAll();
    }
  }

  /**
   * Continues the same task when it was interrupted or something was approved
   * for it since; a different prompt is a new task.
   */
  private resumedSession(prompt: string): string | undefined {
    return (
      this.takeForcedSession() ??
      this.store?.resumableSession(
        this.provider.id,
        this.workspace.root,
        prompt,
      )
    );
  }

  /** Commands denied in this session that nobody has approved yet. */
  private pendingDenials(session: string): number {
    return (
      this.store
        ?.deniedDecisions(this.workspace.root)
        .filter((decision) => decision.session === session).length ?? 0
    );
  }

  /** Executes terminal-local commands instead of forwarding them to the model. */
  private async resolveLocalInput(
    session: string,
    next: NextTurn,
    listen: ((signal?: AbortSignal) => Promise<string>) | undefined,
  ): Promise<NextTurn> {
    if (listen === undefined) return next;

    let current = next;

    while (isLocalApprovalResult(current.input)) {
      if (isApprovalsCommand(current.input)) {
        await this.reviewApprovals();
      }
      const notices =
        this.store?.pendingNotices(this.workspace.root, session) ?? [];
      if (notices.length > 0) {
        return { input: this.continuation(session), approved: true };
      }

      this.show('Nenhuma aprovação foi adicionada.');
      const typed = listenInput(listen, this.runSignal(), (value) =>
        this.dispatchLiveInput(value, session),
      );
      current = await this.nextTurn(
        session,
        typed?.promise,
        this.pendingDenials(session) > 0,
      );
    }

    return current;
  }

  /** The approvals screen, on the agent's own input and output. */
  private async reviewApprovals(): Promise<void> {
    if (this.store === undefined) return;

    // The screen owns the terminal: the agent's output waits until it closes.
    this.held = [];
    try {
      await new ApprovalReview(this.store, this.output).run(
        this.workspace.root,
      );
    } finally {
      const held = this.held;
      this.held = undefined;
      for (const value of held) this.show(value);
      this.renderStatus();
    }
  }

  /**
   * The status line, rewritten in place where the interaction can (the
   * terminal). An interaction without it gets `pensando` as a line, once
   * each time the model starts.
   */
  private setStatus(text: string | undefined): void {
    const fallback =
      this.output.status === undefined &&
      text === THINKING_MESSAGE &&
      this.wantedStatus === undefined;
    const changed = text !== this.wantedStatus;
    this.wantedStatus = text;
    // The agent emits it; each interaction draws it its own way.
    if (changed) publish({ type: 'status', text: text ?? null }, 'debug');
    if (fallback && this.held === undefined) this.show(text);
    this.renderStatus();
  }

  /** Not over the approvals screen or a question being answered. */
  private renderStatus(): void {
    if (this.held !== undefined || this.approving > 0) return;
    this.output.status?.(this.wantedStatus);
  }

  private say(value: string): void {
    if (this.held === undefined) this.show(value);
    else this.held.push(value);
  }

  /** Shows text through the interaction and tells the subscribers. */
  private show(text: string): void {
    this.output.write(text);
    publish({ type: 'message', text }, 'debug');
  }

  /**
   * Runs approvals immediately when its local command is submitted. Without
   * a new approval, `undefined`: the terminal keeps listening (Ctrl+A again).
   */
  private async dispatchLiveInput(
    input: string,
    session: string | undefined,
  ): Promise<string | undefined> {
    if (!isApprovalsCommand(input)) return input;

    if ((this.store?.deniedDecisions(this.workspace.root).length ?? 0) === 0) {
      this.show(
        'Nenhum comando negado para aprovar. De volta ao agente: digite sua mensagem.',
      );
      return undefined;
    }

    await this.reviewApprovals();
    const notices =
      session === undefined
        ? []
        : (this.store?.pendingNotices(this.workspace.root, session) ?? []);
    if (notices.length > 0) return APPROVALS_FINISHED;

    this.show(
      'Nenhuma aprovação foi adicionada. De volta ao agente: digite sua mensagem.',
    );
    return undefined;
  }

  /**
   * The next input: the person's answer, or, if denials are pending, the
   * approvals given meanwhile in `bun run approvals`, whichever comes first.
   */
  private async nextTurn(
    session: string,
    answer: Promise<string> | undefined,
    awaitApproval: boolean,
  ): Promise<NextTurn> {
    const polling = new AbortController();
    const candidates: Promise<{ input: string; approved: boolean }>[] = [];

    if (answer !== undefined) {
      candidates.push(answer.then((input) => ({ input, approved: false })));
    }

    if (awaitApproval) {
      candidates.push(
        this.approvalArrived(session, polling.signal).then(() => ({
          input: this.continuation(session),
          approved: true,
        })),
      );
    }

    try {
      return await abortable(Promise.race(candidates), this.runSignal());
    } finally {
      polling.abort();
    }
  }

  /** Resolves when an approval for this session shows up in the store. */
  private async approvalArrived(
    session: string,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      const notices =
        this.store?.pendingNotices(this.workspace.root, session) ?? [];
      if (notices.length > 0) return;
      await delay(APPROVAL_POLL_MS, signal);
    }

    // Lost the race (an answer came first): never resolve.
    return new Promise(() => undefined);
  }

  /** What the resumed agent is told: approvals since it stopped, then go on. */
  private continuation(session: string): string {
    const notices =
      this.store?.pendingNotices(this.workspace.root, session) ?? [];
    this.store?.markNotified(notices.map((notice) => notice.id));

    return [
      ...describeNotices(
        notices.map((approval) => ({
          approval,
          asked:
            approval.decisionId === undefined
              ? undefined
              : this.store?.decision(approval.decisionId)?.command,
        })),
      ),
      CONTINUE,
    ].join('\n');
  }
}

interface NextTurn {
  readonly input: string;
  readonly approved: boolean;
}

interface PendingInput {
  readonly promise: Promise<string>;
  submitted(): Promise<string> | undefined;
  cancel(): void;
}

/**
 * Reads the terminal for the whole turn, while the provider works. `map`
 * returns `undefined` for input handled locally (Ctrl+A with nothing
 * approved): then it reads again. Ctrl+A keeps working after a message was
 * typed; messages typed during the turn are kept and go together, in order,
 * as the next input. Approvals given before anyone awaits the input do not
 * end the reading either; whoever awaits it later gets them first.
 */
export function listenInput(
  listen: ((signal?: AbortSignal) => Promise<string>) | undefined,
  signal: AbortSignal | undefined,
  map: (input: string) => Promise<string | undefined> = (input) =>
    Promise.resolve(input),
): PendingInput | undefined {
  if (listen === undefined) return undefined;

  const controller = new AbortController();
  const combined = anySignal(signal, controller.signal);
  /** Messages typed while nobody waited for them yet. */
  const messages: string[] = [];
  /** Approvals given while nobody waited for this input yet. */
  let approved = false;
  /** Who awaits the input (a question, the end of the turn), if anyone. */
  let waiter: ((value: string) => void) | undefined;
  let failed: ((error: unknown) => void) | undefined;
  let taken: Promise<string> | undefined;

  const deliver = (value: string): void => {
    controller.abort();
    waiter?.(value);
  };

  const read = async (): Promise<void> => {
    for (;;) {
      const input = await listen(combined);
      // A bare Enter says nothing (e.g. one left in the terminal by the
      // previous program): keep listening instead of ending the turn's input.
      if (input.trim().length === 0) continue;
      const mapped = await map(input);
      if (mapped === undefined) continue;
      if (waiter !== undefined) {
        deliver(mapped);
        return;
      }
      // Nobody waits yet: keep reading (Ctrl+A again, more messages); the
      // end of the turn goes on with what was typed or approved.
      if (mapped === APPROVALS_FINISHED) approved = true;
      else messages.push(mapped);
    }
  };
  void read().catch((error: unknown) => {
    failed?.(error);
  });

  const take = (): Promise<string> => {
    taken ??= ((): Promise<string> => {
      if (messages.length > 0) {
        controller.abort();
        return Promise.resolve(messages.join('\n\n'));
      }
      if (approved) {
        controller.abort();
        return Promise.resolve(APPROVALS_FINISHED);
      }
      return new Promise<string>((resolve, reject) => {
        waiter = resolve;
        failed = reject;
      });
    })();
    return taken;
  };

  return {
    get promise() {
      return take();
    },
    submitted: () => (messages.length > 0 || approved ? take() : undefined),
    cancel: () => controller.abort(),
  };
}

const APPROVAL_COMMANDS: ReadonlySet<string> = new Set([
  ':approvals',
  'bun run approvals',
]);
export const APPROVALS_FINISHED = '\u0000goiaba:approvals-finished';

function isApprovalsCommand(input: string): boolean {
  return APPROVAL_COMMANDS.has(input.trim().toLowerCase());
}

function isLocalApprovalResult(input: string): boolean {
  return input === APPROVALS_FINISHED || isApprovalsCommand(input);
}

const CONTINUE = 'Continue a tarefa de onde parou.';

const APPROVAL_POLL_MS = 1000;

function waitingMessage(count: number): string {
  return `⏸ Aguardando aprovação de ${String(count)} comando(s) negado(s): aperte Ctrl+A (ou rode \`bun run approvals\` em outro terminal). O agente continua sozinho quando aprovar (Ctrl+C para sair).`;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function anySignal(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const defined = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  return defined.length === 0 ? undefined : AbortSignal.any(defined);
}

/** An approval, with what was asked when it approves a denial. */
interface Notice {
  readonly approval: StoredApproval;
  readonly asked: string | undefined;
}

function describeNotices(notices: readonly Notice[]): string[] {
  const commands = notices.filter(
    ({ approval }) => approval.category === 'execution',
  );
  const destinations = notices.filter(
    ({ approval }) => approval.category === 'network',
  );

  return [
    ...(commands.length === 0
      ? []
      : [
          'Permissões atualizadas: estes comandos, que foram bloqueados, agora estão permitidos.',
          'Execute-os de novo, exatamente como estão, antes de seguir:',
          ...commands.map(describeNotice),
        ]),
    ...(destinations.length === 0
      ? []
      : [
          'Rede liberada: estes destinos, que foram bloqueados, agora estão permitidos.',
          'Repita o que precisava deles antes de seguir:',
          ...destinations.map(describeNotice),
        ]),
  ];
}

/**
 * What to run again: the command that was denied, never a pattern (`curl *`
 * would be run as is). The pattern only says what else is now allowed.
 */
function describeNotice({
  approval: { kind, pattern },
  asked,
}: Notice): string {
  if (kind === 'once') return `- (uma vez) ${asked ?? pattern}`;
  if (asked === undefined || asked === pattern) {
    return `- (neste workspace) ${pattern}`;
  }
  return `- (neste workspace) ${asked} — liberado pelo padrão \`${pattern}\``;
}

/** Rejects as soon as the signal aborts, without waiting for the answer. */
function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return promise;
  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return (
    ('name' in error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    ('code' in error && error.code === 'ABORT_ERR')
  );
}

/** `GOIABA_RESUME_SESSION`, if set and not empty. */
function forcedSession(): string | undefined {
  const session = environment()['GOIABA_RESUME_SESSION']?.trim();
  return session === undefined || session.length === 0 ? undefined : session;
}

function defaultStore(): Store | undefined {
  return isConfigLoaded() ? Store.open(getConfig().databasePath) : undefined;
}

/**
 * Filesystem goes to the sandbox; execution to Goiaba's own gate, the same for
 * every CLI (the provider only wires its CLI's hook to it). Returns the gate,
 * if there are execution rules.
 */
function enforcePermissions({
  permissions,
  provider,
  workspace,
  approve,
  store,
}: {
  readonly permissions: AgentPolicy;
  readonly provider: AgentProvider;
  readonly workspace: Workspace;
  readonly approve: CommandApprover;
  readonly store: Store | undefined;
}): {
  readonly broker: ApprovalBroker | undefined;
  readonly network: NetworkBoundary | undefined;
} {
  rejectUnenforced(permissions);
  workspace.applyPermissions(permissions);
  const network = configureNetwork({
    permissions,
    workspace,
    provider,
    approve,
    store,
  });

  const broker = needsGate(permissions, provider)
    ? new ApprovalBroker({
        permissions,
        provider: provider.id,
        root: workspace.root,
        approve,
        ...(store === undefined ? {} : { store }),
      })
    : undefined;
  const gate: ExecutionGate | undefined =
    broker === undefined
      ? undefined
      : { hookCommand: broker.hookCommand(), root: workspace.root };
  const cliFiles = applyProviderPermissions(provider, permissions, gate);

  // What enforces the policy stays read-only for the agent.
  workspace.protect([
    ...(broker === undefined ? [] : [broker.dir]),
    ...cliFiles,
  ]);
  return { broker, network };
}

/** Categories of `AgentPolicy` that Goiaba does not enforce yet. */
const UNENFORCED: readonly PolicyCategory[] = ['tools', 'agents'];

/**
 * With network rules, the sandbox gets no network of its own: everything
 * leaves through Goiaba's proxy, which decides by the policy. The provider's
 * own API always gets through.
 */
function configureNetwork({
  permissions,
  workspace,
  provider,
  approve,
  store,
}: {
  readonly permissions: AgentPolicy;
  readonly workspace: Workspace;
  readonly provider: AgentProvider;
  readonly approve: CommandApprover;
  readonly store: Store | undefined;
}): NetworkBoundary | undefined {
  if (!hasNetworkRules(permissions)) return undefined;

  const network = new NetworkBoundary({
    permissions,
    root: workspace.root,
    provider: provider.id,
    ...(store === undefined ? {} : { store }),
    endpoints: provider.networkEndpoints?.() ?? [],
    blocked: provider.networkBlocked?.() ?? [],
    approve: (request) => approveNetwork(approve, request, provider.id),
    audit: (event) => log.debug({ type: 'network_decision', ...event }),
  });
  workspace.configureNetwork(network);
  return network;
}

function hasNetworkRules(permissions: AgentPolicy): boolean {
  return (['allow', 'requireApproval', 'deny'] as const).some(
    (source) => (permissions[source]?.network?.length ?? 0) > 0,
  );
}

/** The same approver as commands: one prompt, one queue for the person. */
function approveNetwork(
  approve: CommandApprover,
  request: NetworkApprovalRequest,
  provider: string,
): ReturnType<CommandApprover> {
  return approve({
    command: `${request.hostname}:${String(request.port)}`,
    pattern: request.pattern,
    reason: request.reason,
    provider,
    category: 'network',
  });
}

/**
 * Only the provider's share of the host reaches the sandbox: its state, its
 * own credentials and the variables `secrets` allows; every other secret
 * (other logins, tokens in the environment) is not there at all. Applies
 * with or without a policy; without one, no extra variable is allowed.
 */
function shareHost(
  workspace: Workspace,
  provider: AgentProvider,
  permissions: AgentPolicy | undefined,
): void {
  const access = provider.hostAccess?.();
  if (access === undefined) return;

  const policy =
    permissions === undefined ? undefined : new PolicyEngine(permissions);
  // `requireApproval` cannot ask when the variable is read: not let in.
  const allowSecret = (name: string): boolean =>
    policy?.check({ category: 'secrets', operation: 'read', secret: name })
      .policy === 'allow';
  workspace.useHost(sandboxHost(access, environment(), allowSecret));
}

/**
 * Rules Goiaba cannot enforce would be ignored silently: refuse to start
 * instead, as for a category the provider does not apply.
 */
function rejectUnenforced(policy: AgentPolicy): void {
  const category = UNENFORCED.find((name) =>
    (['allow', 'requireApproval', 'deny'] as const).some(
      (source) => (policy[source]?.[name]?.length ?? 0) > 0,
    ),
  );

  if (category !== undefined) {
    throw new UsageError(
      `O Goiaba ainda não aplica a categoria ${category}: tire essas regras do agente.`,
    );
  }
}

function needsGate(permissions: AgentPolicy, provider: AgentProvider): boolean {
  return (
    delegatedCategories(permissions).includes('execution') &&
    provider.applyPermissions !== undefined
  );
}

function applyProviderPermissions(
  provider: AgentProvider,
  permissions: AgentPolicy,
  gate: ExecutionGate | undefined,
): readonly string[] {
  if (provider.applyPermissions !== undefined) {
    return provider.applyPermissions(permissions, gate);
  }

  const category = delegatedCategories(permissions).at(0);

  if (category !== undefined) {
    throw new UsageError(
      `O provider ${provider.id} não aplica a categoria ${category}.`,
    );
  }

  return [];
}

/** Tools go to the log: calls and results in debug, failures as errors. */
function logTool({ phase, detail }: ToolEvent): void {
  if (phase === 'error') log.error({ type: 'tool_error', ...detail });
  else
    log.debug({ type: phase === 'call' ? 'tool' : 'tool_result', ...detail });
}

/** The producer of every agent's events; each event carries its `agent`. */
const AGENT_SOURCE = 'agent';
const agentEvents = createProducer(AGENT_SOURCE);

/** The conversation: for the subscribers and the log. */
function publish(record: LogInput, level?: 'debug' | 'error'): void {
  agentEvents.emit(record);
  if (level === undefined) log.info(record);
  else log[level](record);
}

const THINKING_MESSAGE = '⏳ pensando…';
const FORGOTTEN_SESSION_MESSAGE =
  'A conversa anterior não existe mais na CLI: começando uma nova.';
const BACKGROUND_MESSAGE = '⏳ rodando em background…';
/** How often a `thinking` tick is reported while the model works. */
const THINKING_TICK_MS = 2000;

/**
 * The model's work in a turn, for the subscribers: `start` when the turn
 * begins (and again after a quiet `every` once it has spoken), a `tick` every
 * `every` while the CLI runs without speaking, and `end` when it speaks or
 * the turn ends. Paused (an approval waits for a person), it does not tick.
 * The timer never keeps the program alive.
 */
export function watchThinking(
  onPhase: (phase: 'start' | 'tick' | 'end', seconds: number) => void,
  {
    every = THINKING_TICK_MS,
    paused = (): boolean => false,
  }: { readonly every?: number; readonly paused?: () => boolean } = {},
): { spoke(): void; stop(): void } {
  let thinking = true;
  let since = Date.now();
  let spokeAt = since;
  const seconds = (): number => Math.round((Date.now() - since) / 1000);

  onPhase('start', 0);
  const timer = setInterval(() => {
    if (paused()) return;
    if (thinking) {
      onPhase('tick', seconds());
    } else if (Date.now() - spokeAt >= every) {
      thinking = true;
      since = Date.now();
      onPhase('start', 0);
    }
  }, every);
  timer.unref();

  const end = (): void => {
    if (!thinking) return;
    thinking = false;
    onPhase('end', seconds());
  };

  return {
    spoke: () => {
      end();
      spokeAt = Date.now();
    },
    stop: () => {
      clearInterval(timer);
      end();
    },
  };
}
