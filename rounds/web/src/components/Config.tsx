/**
 * Each actor's pieces as the round used them, and what changed since the
 * run before: without that diff, nobody knows why the results changed.
 */

import type { ReactNode } from 'react';

import type { ActorSnapshot, RoundRecord } from '../../../../src/rounds/types';
import { providerOf, title } from '../format';
import { declaredActor } from '../declaration';
import { ExtractAgent } from './ExtractAgent';

/** The network as one line: the host's, or the rules' default and lists. */
function network(actor: ActorSnapshot): string {
  const { rules } = actor.network;
  if (rules === null) return 'a do host, sem regras';
  const sizes = [
    ['libera', rules.allow?.length ?? 0],
    ['pergunta', rules.requireApproval?.length ?? 0],
    ['nega', rules.deny?.length ?? 0],
  ] as const;
  const lists = sizes
    .filter(([, size]) => size > 0)
    .map(([verb, size]) => `${verb} ${String(size)}`)
    .join(', ');
  const fallback = {
    allow: 'libera',
    deny: 'nega',
    require_approval: 'pergunta',
  }[rules.default];
  return `o resto: ${fallback}${lists === '' ? '' : ` · regras: ${lists}`}`;
}

export function ActorConfigs({
  round,
  open,
}: {
  readonly round: RoundRecord;
  /** The agent whose code opens at once (`?agente=` in the address). */
  readonly open?: string | undefined;
}): ReactNode {
  return (
    <div className="actors">
      {Object.entries(round.actors).map(([name, actor]) => {
        // As declared, or rebuilt from what an older record kept of it.
        const declared = declaredActor(round, name);
        return (
          <article key={name} className="actor">
            <h3>{title(name)}</h3>
            <dl>
              <dt>Modelo</dt>
              <dd>{providerOf(actor)}</dd>
              <dt>Workspace</dt>
              <dd>
                {actor.workspace.type}
                {actor.workspace.image === null
                  ? ''
                  : ` · ${actor.workspace.image}`}
                {` · estado do host: ${actor.workspace.hostState}`}
              </dd>
              <dt>Rede</dt>
              <dd>
                {network(actor)}
                {actor.network.decisions.length > 0 &&
                  ` · ${String(actor.network.decisions.filter((d) => d.decision === 'deny').length)} de ${String(actor.network.decisions.length)} destinos negados`}
              </dd>
              <dt>Permissões</dt>
              <dd>
                {actor.policy === null
                  ? 'sem política: o limite é a sandbox'
                  : `política com default ${actor.policy.default}`}
              </dd>
              <dt>Arquivos</dt>
              <dd>
                {actor.readOnly
                  ? 'pediram que não alterasse nenhum'
                  : 'pode alterar'}
              </dd>
            </dl>
            {declared !== undefined && (
              <ExtractAgent
                name={name}
                actor={declared}
                initiallyOpen={name === open}
              />
            )}
          </article>
        );
      })}
    </div>
  );
}

/** Every leaf of a value, by its path: `provider.model` → `"claude-opus-5-5"`. */
function leaves(value: unknown, path: string, into: Map<string, string>): void {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) {
      leaves(item, path === '' ? key : `${path}.${key}`, into);
    }
    return;
  }
  into.set(path, JSON.stringify(value));
}

/** What is configuration, not result: no hash, no decisions taken in the run. */
function configuration(actor: ActorSnapshot): Map<string, string> {
  const { configHash: _hash, role: _role, ...rest } = actor;
  const into = new Map<string, string>();
  leaves(
    { ...rest, network: { ...rest.network, decisions: undefined } },
    '',
    into,
  );
  into.delete('network.decisions');
  return into;
}

/** `revisor: provider.model "gpt" → "claude"`, one line per difference. */
export function configChanges(
  round: RoundRecord,
  previous: RoundRecord,
): string[] {
  const changes: string[] = [];
  if (round.definition.goal !== previous.definition.goal) {
    changes.push(
      `objetivo: "${previous.definition.goal}" → "${round.definition.goal}"`,
    );
  }
  const names = new Set([
    ...Object.keys(previous.actors),
    ...Object.keys(round.actors),
  ]);
  for (const name of names) {
    const before = previous.actors[name];
    const after = round.actors[name];
    if (before === undefined) {
      changes.push(
        `${name}: entrou (${after === undefined ? '' : providerOf(after)})`,
      );
      continue;
    }
    if (after === undefined) {
      changes.push(`${name}: saiu`);
      continue;
    }
    const a = configuration(before);
    const b = configuration(after);
    for (const path of new Set([...a.keys(), ...b.keys()])) {
      if (a.get(path) !== b.get(path)) {
        changes.push(
          `${name}: ${path} ${a.get(path) ?? 'nada'} → ${b.get(path) ?? 'nada'}`,
        );
      }
    }
  }
  return changes;
}

/** The actor's first prompt in the run. */
const firstPrompt = (record: RoundRecord, actor: string): string | undefined =>
  record.steps.find((step) => step.actor === actor)?.prompt.text;

/** The part of a prompt before what the previous agent said. */
const head = (text: string | undefined): string | undefined =>
  text?.split('\n\n')[0];

/** The prompts that changed, by actor: the configuration leaves them out. */
export function promptChanges(
  round: RoundRecord,
  previous: RoundRecord,
): string[] {
  return Object.keys(round.actors).filter((actor) => {
    const before = firstPrompt(previous, actor);
    const after = firstPrompt(round, actor);
    return (
      before !== undefined &&
      after !== undefined &&
      head(before) !== head(after)
    );
  });
}

/** What a configuration path is, in a few words. */
function pieceOf(path: string): string {
  if (path === 'provider.model') return 'modelo';
  if (path === 'provider.cli') return 'CLI';
  if (path.startsWith('provider')) return 'provider';
  if (path.startsWith('workspace')) return 'workspace';
  if (path.startsWith('network')) return 'rede';
  if (path.startsWith('policy')) return 'política';
  if (path === 'readOnly') return 'só leitura';
  return path;
}

/**
 * What changed from `previous` to `round`, in a few words: `modelo do
 * analista, objetivo, pedido do revisor`. Empty when nothing did.
 */
export function changeSummary(
  round: RoundRecord,
  previous: RoundRecord,
): string[] {
  const parts: string[] = [];
  if (round.definition.goal !== previous.definition.goal)
    parts.push('objetivo');
  const names = new Set([
    ...Object.keys(previous.actors),
    ...Object.keys(round.actors),
  ]);
  for (const name of names) {
    const before = previous.actors[name];
    const after = round.actors[name];
    if (before === undefined || after === undefined) {
      parts.push(`${name} ${before === undefined ? 'entrou' : 'saiu'}`);
      continue;
    }
    const a = configuration(before);
    const b = configuration(after);
    const pieces = new Set(
      [...new Set([...a.keys(), ...b.keys()])]
        .filter((path) => a.get(path) !== b.get(path))
        .map(pieceOf),
    );
    for (const piece of pieces) parts.push(`${piece} do ${name}`);
  }
  for (const actor of promptChanges(round, previous)) {
    parts.push(`pedido do ${actor}`);
  }
  return parts;
}
