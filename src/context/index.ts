/**
 * Which agent is running here: what is emitted or logged inside `runAs`
 * carries its name, provider and run, whoever emits or logs it (the
 * executor, the sandbox, the gate…).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { ProviderDescription } from '../providers/types';

/** Who runs: the agent and what it runs on. */
export interface AgentContext {
  readonly name: string;
  readonly provider?: ProviderDescription;
}

/** Who was running when something was emitted or logged; empty outside an agent. */
export interface RunContext {
  /** Name of the agent (`AgentContext.name`). */
  readonly agent?: string;
  /** Id of the run: one `Agent.run()`. */
  readonly run?: string;
  /** Provider, model and CLI of the agent. */
  readonly agentProvider?: ProviderDescription;
}

const runningAgent = new AsyncLocalStorage<
  AgentContext & { readonly run: string }
>();

/**
 * Runs `work` as `agent`. Inside a run of the same agent, `work` stays in
 * that run.
 */
export function runAs<T>(
  agent: AgentContext,
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

export function currentContext(): RunContext {
  const agent = runningAgent.getStore();
  if (agent === undefined) return {};

  return {
    agent: agent.name,
    run: agent.run,
    ...(agent.provider === undefined ? {} : { agentProvider: agent.provider }),
  };
}
