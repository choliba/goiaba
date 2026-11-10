/**
 * A peça "actor": um agente da rodada, montado das peças que recebe.
 *
 * Sem readOnly: todo ator edita o ticket.txt na sua vez.
 */

import type {
  AgentPolicy,
  AgentProvider,
  WorkspaceOptions,
} from '../../../src';
import type { RoundActor } from '../../../src/rounds';

export interface ActorParams {
  readonly provider: AgentProvider;
  readonly workspace: WorkspaceOptions;
  readonly policy: AgentPolicy;
}

export const actor = ({
  provider,
  workspace,
  policy,
}: ActorParams): RoundActor => ({ provider, workspace, policy });
