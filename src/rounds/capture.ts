/**
 * A round's declaration as data (`RoundDeclaration`), read when it runs:
 * every option given, the prompts with the place of each `said` marked,
 * the rules by id. `declarationSource` writes it back as a file.
 */

import type { RoundDefinition } from './define';
import type { DeclaredActor, RoundDeclaration } from './types';

/** `{{said:analista}}`: where a prompt puts what that actor said. */
const saidMarker = (actor: string): string => `{{said:${actor}}}`;

/**
 * The prompt's lines, called with a `said` whose every entry is its
 * marker; `null` when the prompt does more than join lines and fails so.
 */
function promptLines(step: RoundDefinition['flow'][number]): string[] | null {
  const said = new Proxy<Record<string, string>>(
    {},
    {
      get: (_target, key) =>
        typeof key === 'string' ? saidMarker(key) : undefined,
    },
  );
  try {
    return [...step.prompt({ said })];
  } catch {
    return null;
  }
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
          },
          workspace: {
            type: workspace.type,
            image:
              workspace.type === 'docker' ? (workspace.image ?? null) : null,
            root: workspace.root,
            hostState: workspace.hostState ?? null,
          },
          permissions: actor.permissions ?? null,
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
    ...(definition.instructions === undefined
      ? {}
      : { instructions: definition.instructions }),
    ...(definition.limits === undefined ? {} : { limits: definition.limits }),
    repeat: definition.repeat ?? 1,
  };
}
