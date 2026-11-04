/** Rules a round checks from outside the agents, after it runs. */

import type { RoundRule } from './define';

/** Every actor told not to change files changed none (the git says). */
export function readOnlyRespected(): RoundRule {
  return {
    id: 'read-only-respected',
    check: ({ steps, actors }) =>
      steps
        .filter(
          (step) =>
            Object.hasOwn(actors, step.actor) && actors[step.actor].readOnly,
        )
        .map((step) => ({
          rule: 'read-only-respected',
          actor: step.actor,
          passed: step.changed.length === 0,
          detail:
            step.changed.length === 0
              ? 'O git não mostra nenhuma alteração.'
              : `Alterou arquivos mesmo com o pedido de não alterar: ${step.changed.join(', ')}`,
        })),
  };
}

/** No actor asked anything: in a round, nobody answers. */
export function noQuestions(): RoundRule {
  return {
    id: 'no-questions',
    check: ({ steps }) =>
      steps.map((step) => ({
        rule: 'no-questions',
        actor: step.actor,
        passed: step.asked.length === 0,
        detail:
          step.asked.length === 0
            ? 'Não fez nenhuma pergunta.'
            : `Fez ${String(step.asked.length)} pergunta(s), respondidas pela rodada.`,
      })),
  };
}
