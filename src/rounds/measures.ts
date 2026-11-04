/**
 * What a step measures, from the events it hears: the agent's (turns,
 * tools, usage, what it said and asked) and the network's (decisions). It
 * only listens; it does not know where the events come from, so a test
 * feeds it by hand.
 */

import type {
  NetworkDecisionRecord,
  Span,
  TokenCounts,
  ToolRecord,
  TurnRecord,
  UsageRecord,
} from './types';

/** An event as the recorder takes it: what, when, and its data. */
export interface HeardEvent {
  readonly type: string;
  readonly ts: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/** What a step measured, once it ends. */
export interface StepMeasures {
  readonly said: readonly string[];
  readonly asked: readonly string[];
  readonly turns: readonly TurnRecord[];
  readonly tools: readonly ToolRecord[];
  readonly usage: readonly UsageRecord[];
  readonly decisions: readonly NetworkDecisionRecord[];
}

export const spanOf = (startedAt: string, endedAt: string): Span => ({
  startedAt,
  endedAt,
  durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
});

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const tokens = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;

const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

/** The tool's name, as the CLI reports it in the detail. */
function toolName(detail: Readonly<Record<string, unknown>>): string {
  return (
    text(detail['tool']) ??
    text(detail['name']) ??
    text(detail['type']) ??
    'ferramenta'
  );
}

/**
 * The tool a result answers: the open one with the same id, when the CLI
 * gives ids; otherwise the oldest open one.
 */
function openIndex(
  open: readonly { readonly detail: Readonly<Record<string, unknown>> }[],
  detail: Readonly<Record<string, unknown>>,
): number {
  const id = text(detail['call_id']) ?? text(detail['id']);
  if (id === undefined) return open.length > 0 ? 0 : -1;
  return open.findIndex(
    (tool) => (text(tool.detail['call_id']) ?? text(tool.detail['id'])) === id,
  );
}

export class StepRecorder {
  private readonly said: string[] = [];
  private readonly asked: string[] = [];
  private readonly turns: TurnRecord[] = [];
  private readonly tools: ToolRecord[] = [];
  private readonly usage: UsageRecord[] = [];
  private readonly decisions: NetworkDecisionRecord[] = [];
  private readonly open: {
    readonly turn: number;
    readonly name: string;
    readonly detail: Readonly<Record<string, unknown>>;
    readonly startedAt: string;
  }[] = [];
  private turn = 0;
  private turnStartedAt: string | undefined;

  /**
   * @param actor the step's agent: every usage record carries it.
   * @param cost the price of a request when the CLI does not say it; `null`
   *   when unknown.
   */
  public constructor(
    private readonly actor: string,
    private readonly cost: (tokens: TokenCounts) => number | null = () => null,
  ) {}

  /** One of the agent's events. */
  public agent({ type, ts, data }: HeardEvent): void {
    switch (type) {
      case 'turn': {
        const turn = tokens(data['turn']);
        if (turn === null) return;
        if (data['phase'] === 'start') {
          this.turn = turn;
          this.turnStartedAt = ts;
        } else if (data['phase'] === 'end') {
          this.turns.push({
            index: turn,
            span: spanOf(this.turnStartedAt ?? ts, ts),
          });
          this.turnStartedAt = undefined;
        }
        return;
      }
      case 'tool':
        this.tool(ts, data);
        return;
      case 'usage':
        this.request(ts, data);
        return;
      case 'output': {
        const value = text(data['value']);
        if (value !== undefined) this.said.push(value);
        return;
      }
      case 'ask': {
        const question = text(data['question']);
        if (question !== undefined) this.asked.push(question);
        return;
      }
      default:
    }
  }

  /** A question the round answered for the agent (it asked through the interaction). */
  public question(question: string): void {
    if (!this.asked.includes(question)) this.asked.push(question);
  }

  /** One of the network's decisions while the step ran. */
  public network({ type, ts, data }: HeardEvent): void {
    if (type !== 'decision') return;
    const hostname = text(data['hostname']);
    const port = tokens(data['port']);
    const decision = data['decision'];
    const decidedBy = data['decidedBy'];
    const protocol = data['protocol'];
    if (
      hostname === undefined ||
      port === null ||
      (decision !== 'allow' && decision !== 'deny') ||
      (protocol !== 'http' && protocol !== 'https') ||
      (decidedBy !== 'policy' &&
        decidedBy !== 'default' &&
        decidedBy !== 'provider' &&
        decidedBy !== 'human' &&
        decidedBy !== 'saved')
    ) {
      return;
    }
    this.decisions.push({
      ts,
      destination: `${hostname}:${String(port)}`,
      protocol,
      decision,
      decidedBy,
      reason: text(data['reason']) ?? '',
    });
  }

  /** Everything measured; a tool still open ends `unfinished` at `endedAt`. */
  public finish(endedAt: string): StepMeasures {
    const unfinished = this.open.map((tool): ToolRecord => ({
      turn: tool.turn,
      name: tool.name,
      detail: tool.detail,
      outcome: 'unfinished',
      span: spanOf(tool.startedAt, endedAt),
    }));
    return {
      said: [...this.said],
      asked: [...this.asked],
      turns: [...this.turns],
      tools: [...this.tools, ...unfinished].toSorted((a, b) =>
        a.span.startedAt.localeCompare(b.span.startedAt),
      ),
      usage: [...this.usage],
      decisions: [...this.decisions],
    };
  }

  private tool(ts: string, data: Readonly<Record<string, unknown>>): void {
    const detail = data['detail'];
    const fields: Readonly<Record<string, unknown>> =
      typeof detail === 'object' && detail !== null && !Array.isArray(detail)
        ? Object.fromEntries(Object.entries(detail))
        : {};
    if (data['phase'] === 'call') {
      this.open.push({
        turn: Math.max(1, this.turn),
        name: toolName(fields),
        detail: fields,
        startedAt: ts,
      });
      return;
    }
    const outcome = data['phase'] === 'error' ? 'error' : 'result';
    const index = openIndex(this.open, fields);
    if (index === -1) {
      // A result without its call: kept, with no duration.
      this.tools.push({
        turn: Math.max(1, this.turn),
        name: toolName(fields),
        detail: fields,
        outcome,
        span: spanOf(ts, ts),
      });
      return;
    }
    const call = this.open[index];
    this.open.splice(index, 1);
    this.tools.push({
      turn: call.turn,
      name: call.name,
      detail: { ...call.detail, ...fields },
      outcome,
      span: spanOf(call.startedAt, ts),
    });
  }

  private request(ts: string, data: Readonly<Record<string, unknown>>): void {
    const counts: TokenCounts = {
      input: tokens(data['input_tokens']),
      output: tokens(data['output_tokens']),
      cacheRead: tokens(data['cached_input_tokens']),
      cacheWrite: tokens(data['cache_write_tokens']),
      reasoning: tokens(data['reasoning_tokens']),
    };
    const reported = amount(data['cost_usd']);
    const computed = reported === null ? this.cost(counts) : null;
    this.usage.push({
      ts,
      actor: this.actor,
      turn: Math.max(1, this.turn),
      action: text(data['action']) ?? null,
      tokens: counts,
      costUsd: reported ?? computed,
      costSource:
        reported !== null ? 'cli' : computed !== null ? 'table' : null,
    });
  }
}
