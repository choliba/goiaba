/**
 * A round's declaration: who takes part, in which order, from where, and
 * what is checked. It only declares; `runRound` runs it. Nothing here goes
 * into `runScript` or `Agent.run()`: a round composes agents, the agents do
 * not know they are in one.
 */

import type { AgentProvider } from '../agent/types';
import { UsageError } from '../errors';
import type { AgentPolicy } from '../policy/policy.interface';
import type { WorkspaceOptions } from '../workspace/index';
import type { RuleResult } from './types';

/** One agent of the round. */
export interface RoundActor {
  readonly provider: AgentProvider;
  /** A new workspace with these options for every step of the actor. */
  readonly workspace: WorkspaceOptions;
  readonly permissions?: AgentPolicy;
  /** Told not to change any file: the git checks it (`readOnlyRespected`). */
  readonly readOnly?: boolean;
}

/** What a step's prompt can use: what the agents said before it. */
export interface RoundContext {
  /** By actor, everything it said in its last step, joined. */
  readonly said: Readonly<Record<string, string>>;
}

export interface RoundFlowStep {
  readonly actor: string;
  /** Who consults it, shown before it; another actor of the round. */
  readonly by?: string;
  /** Lines of the prompt; joined with `\n`. */
  readonly prompt: (context: RoundContext) => readonly string[];
}

/** What a rule sees: the steps as they ran, and each actor's declaration. */
export interface RuleInput {
  readonly steps: readonly {
    readonly actor: string;
    readonly said: readonly string[];
    readonly changed: readonly string[];
    readonly asked: readonly string[];
  }[];
  readonly actors: Readonly<Record<string, { readonly readOnly: boolean }>>;
}

/** A check made from outside the agents, after the round. */
export interface RoundRule {
  /** `read-only-respected`. */
  readonly id: string;
  check(input: RuleInput): readonly RuleResult[];
}

export interface RoundStartGit {
  /** The workspace's git repository. */
  readonly root: string;
  /** The tag every run starts from: the workspace is reset to it. */
  readonly tag: string;
}

export interface RoundDefinition {
  /** `analise-programacao-revisao`: lowercase letters, digits and `-`. */
  readonly id: string;
  /**
   * Its name on the pages (`Tarefa do rodapé`); the id when absent. Only a
   * label: changing it changes no configuration.
   */
  readonly title?: string;
  /** What the round wants to find out, in the user's language. */
  readonly goal: string;
  /**
   * What changed since the last run, in your words (`troquei o modelo para
   * o qwen3.5:4b`): recorded in every run until you change it. Only a note:
   * it changes no configuration. `bun run rounds <id> --label "…"` wins.
   */
  readonly label?: string;
  readonly start?: { readonly git: RoundStartGit };
  readonly actors: Readonly<Record<string, RoundActor>>;
  readonly flow: readonly RoundFlowStep[];
  readonly rules?: readonly RoundRule[];
  /** How many times it runs, each run its own record; 1 by default. */
  readonly repeat?: number;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const KNOWN_FIELDS = new Set([
  'id',
  'title',
  'goal',
  'label',
  'start',
  'actors',
  'flow',
  'rules',
  'repeat',
]);

/**
 * The declaration, checked: an unknown field, an actor the flow names but
 * the round does not have, an empty flow… are `UsageError`s that say what
 * to fix.
 */
export function defineRound(definition: RoundDefinition): RoundDefinition {
  const where = `A rodada ${definition.id}`;
  for (const key of Object.keys(definition)) {
    if (!KNOWN_FIELDS.has(key)) {
      throw new UsageError(
        `${where} tem o campo desconhecido "${key}". Os campos são: ${[...KNOWN_FIELDS].join(', ')}.`,
      );
    }
  }
  if (!ID.test(definition.id)) {
    throw new UsageError(
      `O id da rodada ("${definition.id}") deve ter só letras minúsculas, números e hífens, como analise-programacao-revisao.`,
    );
  }
  if (definition.title?.trim().length === 0) {
    throw new UsageError(
      `${where} tem um title vazio: escreva um nome ou tire o campo.`,
    );
  }
  if (definition.label?.trim().length === 0) {
    throw new UsageError(
      `${where} tem um label vazio: descreva a mudança ou tire o campo.`,
    );
  }
  if (definition.goal.trim().length === 0) {
    throw new UsageError(
      `${where} não diz o que quer identificar: preencha o goal.`,
    );
  }
  const actors = Object.keys(definition.actors);
  if (actors.length === 0) {
    throw new UsageError(`${where} não tem nenhum agente em actors.`);
  }
  if (definition.flow.length === 0) {
    throw new UsageError(`${where} não tem nenhum passo em flow.`);
  }
  definition.flow.forEach((step, index) => {
    for (const [field, name] of [
      ['actor', step.actor],
      ['by', step.by],
    ] as const) {
      if (name !== undefined && !actors.includes(name)) {
        throw new UsageError(
          `${where}: o passo ${String(index + 1)} usa ${field} "${name}", que não está em actors (${actors.join(', ')}).`,
        );
      }
    }
  });
  const repeat = definition.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new UsageError(
      `${where}: repeat deve ser um inteiro a partir de 1, veio ${String(repeat)}.`,
    );
  }
  if (definition.start !== undefined) {
    const { root, tag } = definition.start.git;
    if (root.trim().length === 0 || tag.trim().length === 0) {
      throw new UsageError(
        `${where}: start.git precisa de root (o repositório do workspace) e tag (o ponto de partida).`,
      );
    }
  }
  return definition;
}
