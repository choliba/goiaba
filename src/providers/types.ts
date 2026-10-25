import type { ProgramCommand, ProgramOutput } from '../execute/types.js';
import type { AgentPermissions } from '../policy/types.js';

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

/**
 * Every provider takes the same options: an agent is configured the same way
 * whatever the CLI. CLI-specific behavior is derived from what is common (the
 * sandbox, `permissions`), never configured per provider.
 */
export interface ProviderOptions {
  readonly model: string;
  readonly executable?: string;
}

export interface Provider<TInput, TOutput> {
  readonly id: string;
  /**
   * Translates the categories the sandbox cannot enforce (web, execution,
   * communication) into the CLI's own permission mechanism. Must throw a
   * UsageError for anything it cannot apply exactly. Providers without it
   * refuse those categories.
   */
  applyPermissions?(permissions: AgentPermissions): void;
  close?(): void | Promise<void>;
  createCommand(
    input: TInput,
    sessionId?: string,
    workspaceRoot?: string,
  ): ProgramCommand;
  parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<TOutput>>;
}
