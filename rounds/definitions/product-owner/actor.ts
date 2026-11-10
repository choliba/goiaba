/**
 * A peça "actor": o agente Product Owner, montado das peças dele.
 *
 * Sem readOnly: escrever o ticket.md é a tarefa.
 */

import type { RoundActor } from '../../../src/rounds';
import { policy } from './policy';
import { provider } from './provider';
import { workspace } from './workspace';

export const actor: RoundActor = {
  // O modelo e o CLI em que ele roda.
  provider,
  // A pasta em que ele trabalha (a da rodada), dentro de um sandbox.
  workspace,
  // O que ele pode ler, escrever e rodar.
  policy,
};
