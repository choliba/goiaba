import type { Activity } from '../output/activity';
import type { Agent } from './agent';

/**
 * One output of an agent, as its `subscribe` functions receive it: what
 * happened (`type()`, `data()`), when (`ts()`) and which agent (`agent()`).
 * `JSON.stringify` gives the same record the log writes.
 */
export class AgentOutput {
  public constructor(
    private readonly activity: Activity,
    private readonly source: Agent,
  ) {}

  /** The agent itself: `name`, `prompt`, `provider`, `workspace`… */
  public agent(): Agent {
    return this.source;
  }

  /**
   * input, resume, session, output, ask, answer, approved, message, tool,
   * tool_result, tool_error, command_decision, command, sandbox,
   * provider-noise, error…
   */
  public type(): string {
    return this.activity.type;
  }

  /** ISO date and time it was reported. */
  public ts(): string {
    return this.activity.ts;
  }

  /** `debug` for details, `error` for failures; none for the conversation. */
  public level(): 'debug' | 'error' | undefined {
    return this.activity.level;
  }

  /** What was reported, without ts, type, level, agent, run and provider. */
  public data(): Readonly<Record<string, unknown>> {
    const {
      ts: _ts,
      type: _type,
      level: _level,
      agent: _agent,
      run: _run,
      agentProvider: _agentProvider,
      ...data
    } = this.activity;
    return data;
  }

  public toJSON(): Activity {
    return this.activity;
  }
}
