/**
 * Events inside Goiaba: a part emits what happened, whoever listens reacts
 * (e.g. the agent's `subscribe` functions). Nothing here leaves the process:
 * delivering is the output's job, recording is the logger's.
 */

import { currentScope, type ScopeFields } from '../agent/scope';

interface EventBase extends ScopeFields {
  /** Where it came from: `agent` today; `network`, `provider`… later. */
  readonly source: string;
  /** What happened within the source: `input`, `output`, `thinking`… */
  readonly type: string;
  /** ISO date and time it was emitted. */
  readonly ts: string;
}

export interface AgentRunEvent extends EventBase {
  readonly source: 'agent';
  readonly [key: string]: unknown;
}

export type GoiabaEvent = AgentRunEvent;

/** What a producer emits; `ts` and the scope are added on the way. */
export interface EventInput {
  readonly source: GoiabaEvent['source'];
  readonly type: string;
  readonly [key: string]: unknown;
}

export type EventListener = (event: GoiabaEvent) => void;

const listeners = new Set<EventListener>();

export function onEvent(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(input: EventInput): void {
  const event: GoiabaEvent = {
    ts: new Date().toISOString(),
    ...currentScope(),
    ...input,
  };
  for (const listener of listeners) listener(event);
}
