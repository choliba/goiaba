import type {
  ProgramCommand,
  ProgramOutput,
} from '../execute/types.js';

export type AgentEvent<TOutput> =
  | {
      readonly type: 'output';
      readonly value: TOutput;
    }
  | {
      readonly type: 'ask';
      readonly question: string;
    };

export type ProviderEvent<TOutput> =
  | AgentEvent<TOutput>
  | {
      readonly type: 'session';
      readonly id: string;
    };

export interface Provider<TInput, TOutput> {
  readonly id: string;
  createCommand(input: TInput, sessionId?: string): ProgramCommand;
  parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<TOutput>>;
}
