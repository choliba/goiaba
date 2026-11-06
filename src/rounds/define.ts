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
import type { RoundInstruction, RoundLimits, RuleResult } from './types';

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
  readonly actors: Readonly<
    Record<
      string,
      {
        readonly readOnly: boolean;
        /**
         * Where its policy lets it write, relative to the workspace's root
         * (`tickets/**`): what a read-only actor may still change.
         */
        readonly writable: readonly string[];
      }
    >
  >;
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

/**
 * Where every run starts from:
 * - `fixture`: a folder of `rounds/fixtures`, copied into the round's own
 *   folder (`roundDir(id)`, in `rounds.dir`) with a fresh repository;
 * - `git`: a tag in a repository that already exists (a real project).
 * Either way the folder must be the top of its own repository, apart from
 * the Goiaba's project.
 */
export type RoundStartDefinition =
  { readonly fixture: string } | { readonly git: RoundStartGit };

export interface RoundDefinition {
  /** `analise-programacao-revisao`: lowercase letters, digits and `-`. */
  readonly id: string;
  /** What the round wants to find out, in the user's language. */
  readonly goal: string;
  /**
   * What changed since the last run, in your words (`troquei o modelo para
   * o qwen3.5:4b`): recorded in every run until you change it. Only a note:
   * it changes no configuration. `bun run rounds <id> --label "…"` wins.
   */
  readonly label?: string;
  readonly start?: RoundStartDefinition;
  readonly actors: Readonly<Record<string, RoundActor>>;
  readonly flow: readonly RoundFlowStep[];
  readonly rules?: readonly RoundRule[];
  /**
   * By actor, the instructions of its prompt the round can check by itself:
   * a file that must be there at the end of its step, holding a passage.
   * Score whether it did what it was asked (see rounds/README.md).
   */
  readonly instructions?: Readonly<Record<string, readonly RoundInstruction[]>>;
  /** Limits set before the run (time, cost): meeting them is part of the goal. */
  readonly limits?: RoundLimits;
  /** How many times it runs, each run its own record; 1 by default. */
  readonly repeat?: number;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const KNOWN_FIELDS = new Set([
  'id',
  'goal',
  'label',
  'start',
  'actors',
  'flow',
  'rules',
  'repeat',
  'instructions',
  'limits',
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
  for (const [field, names] of [
    ['instructions', Object.keys(definition.instructions ?? {})],
    ['limits.actorMs', Object.keys(definition.limits?.actorMs ?? {})],
  ] as const) {
    for (const name of names) {
      if (!actors.includes(name)) {
        throw new UsageError(
          `${where}: ${field} fala de "${name}", que não está em actors (${actors.join(', ')}).`,
        );
      }
    }
  }
  for (const [name, list] of Object.entries(definition.instructions ?? {})) {
    for (const instruction of list) {
      const files = [
        instruction.when,
        instruction.check,
        instruction.otherwise,
      ].filter(
        (
          check,
        ): check is { readonly file: string; readonly contains?: string } =>
          check !== undefined && 'file' in check,
      );
      for (const { file, contains } of files) {
        if (
          file.trim().length === 0 ||
          file.startsWith('/') ||
          file.split('/').includes('..')
        ) {
          throw new UsageError(
            `${where}: instructions.${name} tem o arquivo "${file}"; use um caminho relativo à raiz do workspace, como tickets/ticket-01.txt.`,
          );
        }
        if (contains?.trim().length === 0) {
          throw new UsageError(
            `${where}: instructions.${name} tem um contains vazio em ${file}: escreva o trecho ou tire o campo.`,
          );
        }
      }
      if (
        instruction.otherwise !== undefined &&
        instruction.when === undefined
      ) {
        throw new UsageError(
          `${where}: instructions.${name} tem otherwise sem when: o otherwise vale quando a condição (when) não vale.`,
        );
      }
    }
  }
  const { roundMs, costUsd, actorMs = {} } = definition.limits ?? {};
  for (const [field, value] of [
    ['limits.roundMs', roundMs],
    ['limits.costUsd', costUsd],
    ...Object.entries(actorMs).map(
      ([name, ms]) => [`limits.actorMs.${name}`, ms] as const,
    ),
  ] as const) {
    if (value !== undefined && !(value > 0)) {
      throw new UsageError(
        `${where}: ${field} deve ser maior que zero, veio ${String(value)}.`,
      );
    }
  }
  const repeat = definition.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new UsageError(
      `${where}: repeat deve ser um inteiro a partir de 1, veio ${String(repeat)}.`,
    );
  }
  if (definition.start !== undefined) checkStart(definition.start, where);
  return definition;
}

function checkStart(start: RoundStartDefinition, where: string): void {
  const keys = Object.keys(start);
  if (keys.length !== 1 || !(keys[0] === 'fixture' || keys[0] === 'git')) {
    throw new UsageError(
      `${where}: start leva fixture (uma pasta de rounds/fixtures) ou git (root e tag de um repositório que já existe), um dos dois; veio ${keys.join(', ') || 'nada'}.`,
    );
  }
  if ('fixture' in start) {
    const name = start.fixture;
    if (
      name.trim().length === 0 ||
      name.includes('/') ||
      name.includes('\\') ||
      name === '.' ||
      name === '..'
    ) {
      throw new UsageError(
        `${where}: start.fixture deve ser o nome de uma pasta de rounds/fixtures, como site-vazio; veio "${name}".`,
      );
    }
    return;
  }
  const { root, tag } = start.git;
  if (root.trim().length === 0 || tag.trim().length === 0) {
    throw new UsageError(
      `${where}: start.git precisa de root (o repositório do workspace) e tag (o ponto de partida).`,
    );
  }
}
