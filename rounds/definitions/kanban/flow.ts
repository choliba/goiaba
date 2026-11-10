/**
 * A peça "flow": os passos da rodada, em ordem.
 *
 * O motor roda uma lista fixa de passos, mas o kanban anda e volta conforme o
 * status de cada fase. Por isso o fluxo é um rodízio: os atores passam na
 * ordem, `cycles` vezes, e cada um só age se o PROXIMO_ATOR do ticket for
 * ele. O caminho feliz precisa de 2 ciclos (o aceite do po cai no segundo);
 * cada volta (ajustes, falha no deploy, reprovação) pede mais um.
 */

import type { RoundFlowStep } from '../../../src/rounds';
import type { ActorName } from './actors-names';

export interface FlowParams {
  /** Os atores, na ordem em que passam a cada ciclo. */
  readonly order: readonly ActorName[];
  /** Quantas vezes o rodízio passa por todos. */
  readonly cycles: number;
  /** O pedido de cada ator. */
  readonly prompt: (actor: ActorName) => RoundFlowStep['prompt'];
}

export const flow = ({ order, cycles, prompt }: FlowParams): RoundFlowStep[] =>
  Array.from({ length: cycles }, () =>
    order.map((actor) => ({ actor, prompt: prompt(actor) })),
  ).flat();
