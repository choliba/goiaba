import { randomUUID } from 'node:crypto';

import { OutputDispatcher, type Executor } from '../execute/index';
import { log } from '../logger/index';
import type { LiveTurn, Provider, ProviderEvent } from '../providers/types';
import type { Workspace } from '../workspace/index';

export interface ProviderRun<TInput> {
  readonly executor: Executor;
  readonly workspace: Workspace;
  readonly input: TInput;
  readonly sessionId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Where every run's events are also published, for whoever follows them all. */
  readonly dispatcher?: OutputDispatcher<ProviderEvent<string>> | undefined;
  /**
   * Wants the turn live, where the provider can: receives it to send what is
   * typed while the CLI runs. Without it, or a provider that cannot, the
   * input is written whole, as always.
   */
  readonly onLive?: ((turn: LiveTurn) => void) | undefined;
}

/**
 * One turn of a provider's CLI, joining the pieces that do not know each
 * other: the provider says what to run, the workspace wraps it in its
 * sandbox, the executor runs it, and the provider reads what it printed.
 * Starts right away; the events come as the CLI prints them.
 */
export function runProvider(
  provider: Provider<string, string>,
  {
    executor,
    workspace,
    input,
    sessionId,
    signal,
    dispatcher = new OutputDispatcher<ProviderEvent<string>>(),
    onLive,
  }: ProviderRun<string>,
): AsyncIterable<ProviderEvent<string>> {
  const executionId = randomUUID();
  const events = dispatcher.open(executionId, provider.id);

  const turn = async (): Promise<void> => {
    signal?.throwIfAborted();
    const live =
      onLive === undefined
        ? undefined
        : provider.createLiveTurn?.(input, sessionId);
    const inner =
      live?.command ?? provider.createCommand(input, sessionId, workspace.root);
    // Before the sandbox wraps it: what the provider asked for.
    log.debug({
      type: 'command',
      phase: 'inner',
      executionId,
      provider: provider.id,
      executable: inner.executable,
      arguments: inner.arguments ?? [],
      cwd: inner.cwd ?? workspace.root,
    });

    const command = await workspace.prepare(inner);
    const output = executor.run(command, {
      ...(signal === undefined ? {} : { signal }),
      onStart: (pid) => workspace.sandbox.started?.(pid),
      // The CLI may run as a grandchild (nsenter -p forks): only tearing
      // down the sandbox reaches it.
      onAbort: () => void workspace.close(),
      logFields: { executionId, provider: provider.id },
    });

    if (live !== undefined) onLive?.(live);
    try {
      for await (const event of provider.parseOutput(output)) {
        dispatcher.publish(executionId, provider.id, event);
      }
    } finally {
      live?.close();
    }
  };

  turn().then(
    () => {
      dispatcher.close(executionId, provider.id);
    },
    (error: unknown) => {
      dispatcher.fail(
        executionId,
        provider.id,
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  );
  return events;
}
