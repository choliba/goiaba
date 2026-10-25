import type { AgentAsk, AgentOptions, AgentProvider } from './types.js';
import { Executor, ProgramExecutionError } from '../execute/index.js';
import {
  closeLogger,
  getLogger,
  isLoggerOpen,
  logFailure,
  openLogger,
} from '../log/index.js';
import type { AgentEvent } from '../providers/types.js';
import { delegatedCategories, type AgentPermissions } from '../policy/index.js';
import { UsageError } from '../errors.js';
import { StandardOutput, type OutputAdapter } from '../output/index.js';
import { scriptSignal } from '../usage.js';
import type { Workspace } from '../workspace/index.js';

export class Agent {
  public readonly prompt: string;

  private readonly provider: AgentProvider;
  private readonly executor: Executor;
  private readonly workspace: Workspace;
  private readonly output: OutputAdapter;
  private readonly signal: AbortSignal | undefined;

  public constructor({
    prompt,
    provider,
    workspace,
    executor,
    output,
    interaction = new StandardOutput(),
    permissions,
    signal = scriptSignal(),
  }: AgentOptions) {
    if (prompt.trim().length === 0) {
      throw new Error('O prompt do agente não pode estar vazio.');
    }

    if (executor !== undefined && output !== undefined) {
      throw new Error('Informe executor ou output, não ambos.');
    }

    this.prompt = prompt;
    this.provider = provider;
    this.workspace = workspace;
    this.executor =
      executor ?? new Executor(output === undefined ? {} : { output });
    this.output = interaction;
    this.signal = signal;
    if (permissions !== undefined) {
      workspace.applyPermissions(permissions);
      applyProviderPermissions(provider, permissions);
    }
  }

  public async run(): Promise<void> {
    try {
      for await (const event of this.interact(this.prompt, (question) =>
        this.output.ask(question, this.signal),
      )) {
        if (event.type === 'output') {
          this.output.write(event.value);
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        this.output.write('\n');
        return;
      }

      if (
        error instanceof UsageError ||
        error instanceof ProgramExecutionError
      ) {
        this.output.write(error.message);
        return;
      }

      throw error;
    }
  }

  public async *interact(
    input: string,
    answer: AgentAsk,
  ): AsyncIterable<AgentEvent<string>> {
    // runScript owns the log of the whole script; outside it, the agent does.
    const ownsLogger = !isLoggerOpen();
    const logger = ownsLogger ? openLogger() : getLogger();
    logger.log({ type: 'input', value: input });

    let nextInput = input;
    let sessionId: string | undefined;

    try {
      while (true) {
        let pendingAnswer: Promise<string> | undefined;

        for await (const event of this.executor.run(
          this.provider,
          this.workspace,
          nextInput,
          sessionId,
          this.signal,
        )) {
          if (event.type === 'session') {
            sessionId = event.id;
            logger.log({ type: 'session', id: event.id });
            continue;
          }

          logger.log({ ...event });

          if (event.type === 'ask') {
            yield { type: 'output', value: event.question };
          }

          yield event;

          if (event.type === 'ask' && pendingAnswer === undefined) {
            pendingAnswer = Promise.resolve(answer(event.question));
            // Keep the rejection handled until this turn finishes and awaits it.
            void pendingAnswer.catch(() => undefined);
          }
        }

        if (pendingAnswer === undefined) {
          return;
        }

        if (sessionId === undefined) {
          throw new Error('O provider não informou o identificador da sessão.');
        }

        nextInput = await abortable(pendingAnswer, this.signal);
        logger.log({ type: 'answer', value: nextInput });
      }
    } catch (error) {
      if (!isAbortError(error)) {
        logFailure(error);
      }

      throw error;
    } finally {
      if (ownsLogger) closeLogger();
      await this.provider.close?.();
      await this.workspace.close();
    }
  }
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

function applyProviderPermissions(
  provider: AgentProvider,
  permissions: AgentPermissions,
): void {
  if (provider.applyPermissions !== undefined) {
    provider.applyPermissions(permissions);
    return;
  }

  const [category] = delegatedCategories(permissions);

  if (category !== undefined) {
    throw new UsageError(
      `O provider ${provider.id} não aplica a categoria ${category}.`,
    );
  }
}
