/**
 * A round's declaration as data (`RoundDeclaration`), read when it runs:
 * every option given, the prompts with the place of each `said` marked,
 * the rules by id. `declarationSource` writes it back as a file.
 */

import type { RoundActor, RoundDefinition, RoundRepeat } from './define';
import type {
  DeclaredActor,
  DeclaredOptionValue,
  RoundCriteria,
  RoundCriterion,
  RoundDeclaration,
} from './types';

/** `{{said:analista}}`: where a prompt puts what that actor said. */
const saidMarker = (actor: string): string => `{{said:${actor}}}`;

/** `{{input:termo}}`: where a prompt puts an input's answer. */
const inputMarker = (name: string): string => `{{input:${name}}}`;

/**
 * The run's numbers as their markers, `{{repeat:index}}` and
 * `{{repeat:total}}`: text where the prompt expects numbers. A prompt that
 * writes them (`String(repeat.index)`) is captured as it is; arithmetic
 * with them (`repeat.index + 1`) would be captured wrong, so a prompt only
 * writes them.
 */
function repeatMarkers(): RoundRepeat {
  return new Proxy<RoundRepeat>(
    { index: 0, total: 0 },
    {
      get: (_target, key) =>
        typeof key === 'string' ? `{{repeat:${key}}}` : undefined,
    },
  );
}

/** A record whose every entry is its marker. */
const markers = (mark: (key: string) => string): Record<string, string> =>
  new Proxy<Record<string, string>>(
    {},
    {
      get: (_target, key) => (typeof key === 'string' ? mark(key) : undefined),
    },
  );

/**
 * The prompt's lines, called with a `said` whose every entry is its
 * marker; `null` when the prompt does more than join lines and fails so.
 */
function promptLines(step: RoundDefinition['flow'][number]): string[] | null {
  try {
    return [
      ...step.prompt({
        said: markers(saidMarker),
        inputs: markers(inputMarker),
        repeat: repeatMarkers(),
      }),
    ];
  } catch {
    return null;
  }
}

/** The provider options the declaration's own fields already say. */
const MODELED = new Set(['cli', 'model', 'contextWindow', 'think', 'tools']);

/** An option as data, when it is one (a function or object is not written back). */
function optionValue(value: unknown): DeclaredOptionValue | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return Array.isArray(value) &&
    value.every((item): item is string => typeof item === 'string')
    ? value
    : undefined;
}

/** The constructor's other options, as written; `undefined` without any. */
function otherOptions(
  provider: RoundActor['provider'],
): Readonly<Record<string, DeclaredOptionValue>> | undefined {
  const entries = Object.entries(provider.declaredOptions?.() ?? {}).flatMap(
    ([key, value]): [string, DeclaredOptionValue][] => {
      const data = MODELED.has(key) ? undefined : optionValue(value);
      return data === undefined ? [] : [[key, data]];
    },
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** The declaration as data, with `label` the run's (the `--label` given, if any). */
export function captureDeclaration(
  definition: RoundDefinition,
  label: string | undefined,
): RoundDeclaration {
  const { start } = definition;
  return {
    id: definition.id,
    goal: definition.goal,
    ...(label === undefined || label.trim().length === 0
      ? {}
      : { label: label.trim() }),
    start:
      start === undefined
        ? null
        : 'fixture' in start
          ? { fixture: start.fixture }
          : { git: { root: start.git.root, tag: start.git.tag } },
    actors: Object.fromEntries(
      Object.entries(definition.actors).map(([name, actor]) => {
        const described = actor.provider.describe?.();
        const options = otherOptions(actor.provider);
        const { workspace } = actor;
        const declared: DeclaredActor = {
          provider: {
            name: described?.name ?? actor.provider.id,
            cli: described?.cli ?? null,
            model: described?.model ?? null,
            ...(described?.contextWindow === undefined
              ? {}
              : { contextWindow: described.contextWindow }),
            ...(described?.think === undefined
              ? {}
              : { think: described.think }),
            ...(described?.tools === undefined
              ? {}
              : { tools: described.tools }),
            ...(options === undefined ? {} : { options }),
          },
          workspace: {
            type: workspace.type,
            image:
              workspace.type === 'docker' ? (workspace.image ?? null) : null,
            root: workspace.root,
            hostState: workspace.hostState ?? null,
            ...(workspace.writable === undefined
              ? {}
              : { writable: workspace.writable }),
            ...(workspace.ports === undefined
              ? {}
              : { ports: workspace.ports }),
            ...(workspace.homes === undefined
              ? {}
              : { homes: workspace.homes }),
          },
          policy: actor.policy ?? null,
          readOnly: actor.readOnly ?? false,
        };
        return [name, declared];
      }),
    ),
    flow: definition.flow.map((step) => ({
      actor: step.actor,
      by: step.by ?? null,
      prompt: promptLines(step),
    })),
    rules: (definition.rules ?? []).map((rule) => rule.id),
    ...(definition.criteria === undefined
      ? {}
      : { criteria: serializeCriteria(definition.criteria) }),
    ...(definition.inputs === undefined ? {} : { inputs: definition.inputs }),
    repeat: definition.repeat ?? 1,
  };
}

/** The criteria as data: each `matches` RegExp becomes its source string. */
export function serializeCriteria(criteria: RoundCriteria): RoundCriteria {
  const one = (criterion: RoundCriterion): RoundCriterion => {
    if ('file' in criterion) {
      const { matches } = criterion.file;
      return matches === undefined
        ? criterion
        : {
            file: {
              ...criterion.file,
              matches: matches.map((m) =>
                typeof m === 'string' ? m : m.source,
              ),
            },
          };
    }
    if ('if' in criterion) {
      return {
        if: criterion.if,
        check: criterion.check.map(one),
        ...(criterion.else === undefined
          ? {}
          : { else: criterion.else.map(one) }),
      };
    }
    return criterion;
  };
  return Object.fromEntries(
    Object.entries(criteria).map(([name, list]) => [name, list.map(one)]),
  );
}
