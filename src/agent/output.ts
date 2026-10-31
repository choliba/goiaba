import type { GoiabaEvent } from '../events/index';
import type { Agent } from './agent';

/**
 * One event of an agent, as its `subscribe` functions receive it: what
 * happened (`type()`, `data()`), when (`ts()`) and which agent (`agent()`).
 */
export class AgentOutput {
  public constructor(
    private readonly event: GoiabaEvent,
    private readonly source: Agent,
  ) {}

  /** The agent itself: `name`, `prompt`, `provider`, `workspace`… */
  public agent(): Agent {
    return this.source;
  }

  /**
   * input, resume, resume_failed, session, output, ask, answer, approved,
   * message, status, thinking, error…
   */
  public type(): string {
    return this.event.type;
  }

  /** ISO date and time it was reported. */
  public ts(): string {
    return this.event.ts;
  }

  /** What was emitted, without source, ts, type, agent, run and provider. */
  public data(): Readonly<Record<string, unknown>> {
    const {
      source: _source,
      ts: _ts,
      type: _type,
      agent: _agent,
      run: _run,
      agentProvider: _agentProvider,
      ...data
    } = this.event;
    return data;
  }

  public toJSON(): GoiabaEvent {
    return this.event;
  }
}
