/**
 * The one channel for everything Goiaba does while an agent runs: the
 * conversation, CLI commands, sandboxes, tools, command decisions, errors.
 * Producers `report`; consumers listen with `onActivity` — the log (to file)
 * and the agent's `subscribe` functions.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { ProviderDescription } from '../providers/types';

/** What a producer reports; `ts` is added on the way. */
export interface ActivityReport {
  readonly type: string;
  /** `debug` reaches the log file only with `debug: true`; errors always. */
  readonly level?: 'debug' | 'error';
  readonly [key: string]: unknown;
}

export interface Activity extends ActivityReport {
  readonly ts: string;
  /** Name of the agent that was running when it was reported. */
  readonly agent?: string;
  /** The agent's run (one `Agent.run()`) it was reported in. */
  readonly run?: string;
  /** Provider, model and CLI of that agent. */
  readonly agentProvider?: ProviderDescription;
}

/** Who reports: the agent and what it runs on. */
export interface AgentScope {
  readonly name: string;
  readonly provider?: ProviderDescription;
}

export type ActivityListener = (activity: Activity) => void;

type Unleveled = ActivityReport & { readonly level?: never };

const listeners = new Set<ActivityListener>();
const runningAgent = new AsyncLocalStorage<
  AgentScope & { readonly run: string }
>();

/**
 * Runs `work` as `agent`: what it reports, directly or through the executor,
 * sandbox or gate it calls, carries the agent's name, provider and the id of
 * the run. Inside a run of the same agent, `work` stays in that run.
 */
export function asAgent<T>(
  agent: AgentScope,
  work: () => T,
  run: string = currentRun(agent.name) ?? randomUUID(),
): T {
  return runningAgent.run({ ...agent, run }, work);
}

/** The run of agent `name` in progress here, if any. */
export function currentRun(name: string): string | undefined {
  const current = runningAgent.getStore();
  return current?.name === name ? current.run : undefined;
}

export function onActivity(listener: ActivityListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function report(record: ActivityReport): void {
  const agent = runningAgent.getStore();
  const activity: Activity = {
    ts: new Date().toISOString(),
    ...(agent === undefined
      ? {}
      : {
          agent: agent.name,
          run: agent.run,
          ...(agent.provider === undefined
            ? {}
            : { agentProvider: agent.provider }),
        }),
    ...record,
  };
  for (const listener of listeners) listener(activity);
}

export function reportDebug(record: Unleveled): void {
  report({ level: 'debug', ...record });
}

/** Kept in the log even without `debug`, with `log.level: error`. */
export function reportError(record: Unleveled): void {
  report({ level: 'error', ...record });
}

const reportedFailures = new WeakSet<object>();

/** Reports a thrown error once, however many layers see it on its way up. */
export function reportFailure(error: unknown): void {
  if (typeof error === 'object' && error !== null) {
    if (reportedFailures.has(error)) return;
    reportedFailures.add(error);
  }

  reportError({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
}

export function reportCommand(record: {
  readonly phase: string;
  readonly executable: string;
  readonly arguments?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
  readonly [key: string]: unknown;
}): void {
  // Without `arguments` the record has none: `[]` would say "no arguments".
  reportDebug({ type: 'command', ...record });
}
