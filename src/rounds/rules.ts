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

/**
 * A tool call the model wrote as its answer, instead of calling the tool:
 * `{"name": "exec_command", "arguments": {...}}`. The CLI runs nothing, and
 * the round looks done. Happens with models that do not speak the CLI's
 * tool protocol.
 */
function writtenToolCall(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (
      typeof value === 'object' &&
      value !== null &&
      'name' in value &&
      typeof value.name === 'string' &&
      'arguments' in value
    ) {
      return value.name;
    }
  } catch {
    // Not JSON: an ordinary answer.
  }
  return undefined;
}

/** No actor answered with a tool call written as text (nothing ran). */
export function noToolCallAsText(): RoundRule {
  return {
    id: 'no-tool-call-as-text',
    check: ({ steps }) =>
      steps.map((step) => {
        const calls = step.said
          .map(writtenToolCall)
          .filter((name) => name !== undefined);
        return {
          rule: 'no-tool-call-as-text',
          actor: step.actor,
          passed: calls.length === 0,
          detail:
            calls.length === 0
              ? 'Não respondeu com uma chamada de ferramenta escrita como texto.'
              : `Respondeu com a chamada de ferramenta escrita como texto (${calls.join(', ')}), e nada rodou: o modelo não chama as ferramentas da CLI.`,
        };
      }),
  };
}
