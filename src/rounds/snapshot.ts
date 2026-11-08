/**
 * Each agent's pieces as used, copied from the real objects when it starts
 * (never retyped from the declaration), and the hashes that say whether two
 * runs had the same configuration.
 */

import { createHash } from 'node:crypto';

import type { AgentProvider } from '../agent/types';
import { networkRulesOf } from '../network/rules';
import type { AgentPolicy } from '../policy/policy.interface';
import type { Workspace } from '../workspace/index';
import type { ActorSnapshot, Prompt, RoundDefinitionRef } from './types';

/** What an actor ran with, as the round has it. */
export interface ActorPieces {
  readonly role: string;
  readonly provider: AgentProvider;
  readonly workspace: Workspace;
  readonly permissions: AgentPolicy | undefined;
  readonly readOnly: boolean;
}

/** JSON with the keys of every object sorted: the same value, the same text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          // By code point, not by locale: the same text on any machine.
          Object.entries(item).toSorted(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : item,
  );
}

export const sha256 = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

export const promptOf = (text: string): Prompt => ({
  text,
  hash: sha256(text),
});

/**
 * The actor's snapshot. `clean` takes out of paths what must not be
 * committed (the project's path, the home).
 */
export function snapshotActor(
  { role, provider, workspace, permissions, readOnly }: ActorPieces,
  clean: (text: string) => string = (text) => text,
): ActorSnapshot {
  const described = provider.describe?.();
  const { options } = workspace;
  const pieces: Omit<ActorSnapshot, 'configHash'> = {
    role,
    provider: {
      id: provider.id,
      name: described?.name ?? provider.id,
      model: described?.model ?? 'desconhecido',
      cli: described?.cli ?? null,
      cliVersion: null,
      options: {},
      ...(described?.contextWindow === undefined
        ? {}
        : { contextWindow: described.contextWindow }),
      ...(described?.readableContext === undefined
        ? {}
        : { readableContext: described.readableContext }),
      ...(described?.think === undefined ? {} : { think: described.think }),
    },
    workspace: {
      type: options.type,
      image: options.type === 'docker' ? (options.image ?? null) : null,
      root: clean(options.root),
      writable: (options.writable ?? []).map(clean),
      hostState: workspace.hostState,
      ports: options.ports ?? [],
    },
    network: {
      rules: permissions === undefined ? null : networkRulesOf(permissions),
      alwaysAllow: provider.networkEndpoints?.() ?? [],
      alwaysDeny: provider.networkBlocked?.() ?? [],
      decisions: [],
    },
    policy: permissions ?? null,
    readOnly,
  };
  return { ...pieces, configHash: configHash(pieces) };
}

/**
 * Over the configuration only: what the network decided during the run is a
 * result, not configuration, and stays out.
 */
function configHash(pieces: Omit<ActorSnapshot, 'configHash'>): string {
  return sha256(
    stableJson({
      ...pieces,
      network: { ...pieces.network, decisions: [] },
    }),
  );
}

/**
 * Over the declaration (id and goal) and every actor's hash, by name: same
 * hash, a repetition. The prompts carry what the agents said, so they stay
 * out: a round whose prompts change says so in its goal.
 */
export function roundConfigHash(
  definition: RoundDefinitionRef,
  actors: Readonly<Record<string, ActorSnapshot>>,
): string {
  return sha256(
    stableJson({
      definition,
      actors: Object.fromEntries(
        Object.entries(actors).map(([name, actor]) => [name, actor.configHash]),
      ),
    }),
  );
}
