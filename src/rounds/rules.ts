/** Rules a round checks from outside the agents, after it runs. */

import type { AgentPolicy } from '../policy/policy.interface';
import { wildmatch } from '../policy/wildmatch';
import type { RoundRule } from './define';

/**
 * Where a policy lets the agent write, relative to the workspace's root:
 * each filesystem `allow` with `write`, as `tickets/**`. A path outside
 * `/workspace` is not the workspace's, and stays out.
 */
export function writableOf(policy: AgentPolicy | null): string[] {
  return (policy?.allow?.filesystem ?? [])
    .filter((rule) =>
      rule.operations.some((op) => op === 'write' || op === '*'),
    )
    .flatMap((rule) => rule.paths)
    .filter((path) => path.startsWith('/workspace/'))
    .map((path) => path.slice('/workspace/'.length));
}

/** The path of a `git status --porcelain` line; a rename's new name. */
function statusPath(line: string): string {
  const path = line.slice(3);
  const renamed = path.indexOf(' -> ');
  return renamed === -1 ? path : path.slice(renamed + ' -> '.length);
}

/**
 * Every actor told not to change files changed none outside where its
 * policy lets it write (the git says): a ticket written in a folder the
 * policy opens for writing is not a violation; a change anywhere else is.
 */
export function readOnlyRespected(): RoundRule {
  return {
    id: 'read-only-respected',
    check: ({ steps, actors }) =>
      steps
        .filter(
          (step) =>
            Object.hasOwn(actors, step.actor) && actors[step.actor].readOnly,
        )
        .map((step) => {
          const writable = actors[step.actor].writable;
          const outside = step.changed.filter(
            (line) =>
              !writable.some((pattern) => wildmatch(statusPath(line), pattern)),
          );
          const allowed = step.changed.length - outside.length;
          return {
            rule: 'read-only-respected',
            actor: step.actor,
            passed: outside.length === 0,
            detail:
              outside.length > 0
                ? `Alterou arquivos fora do que a política libera para escrita: ${outside.join(', ')}`
                : allowed > 0
                  ? `Só alterou onde a política libera escrita (${writable.join(', ')}): ${step.changed.join(', ')}`
                  : 'O git não mostra nenhuma alteração.',
          };
        }),
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
