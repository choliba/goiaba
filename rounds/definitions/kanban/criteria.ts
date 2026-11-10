/**
 * A peça "criteria": o que a rodada confere no fim de cada passo de um ator.
 *
 * Como o fluxo é um rodízio, o critério depende da vez, lida no ticket no
 * início do passo:
 * - era a vez do ator → o ticket.txt mudou e ganhou uma linha dele no
 *   HISTORICO (e o que `extra` pedir para aquele ator, como o index.html
 *   implementado pelo dev);
 * - não era → nenhum arquivo mudou.
 *
 * O `\n` depois do nome evita que "PROXIMO_ATOR: dev" valha também para o
 * devops.
 */

import type { RoundCriteria, RoundCriterion } from '../../../src/rounds';
import type { ActorName } from './actors-names';

const TICKET = 'ticket.txt';

export interface CriteriaParams {
  readonly names: readonly ActorName[];
  /** Critérios a mais na vez de um ator: sobre o ticket ou outro arquivo. */
  readonly extra?: Partial<
    Readonly<Record<ActorName, readonly RoundCriterion[]>>
  >;
}

const turnOf = (
  actor: ActorName,
  extra: readonly RoundCriterion[],
): RoundCriterion => ({
  if: { name: TICKET, contains: [`PROXIMO_ATOR: ${actor}\n`] },
  check: [
    {
      file: {
        name: TICKET,
        changed: true,
        matches: [new RegExp(String.raw`\[rodada \d+\] ${actor} \|`)],
      },
    },
    ...extra,
  ],
  else: [{ file: { name: '*', changed: false } }],
});

export const criteria = ({
  names,
  extra = {},
}: CriteriaParams): RoundCriteria =>
  Object.fromEntries(
    names.map((name) => [name, [turnOf(name, extra[name] ?? [])]]),
  );
