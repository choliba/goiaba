/**
 * A peça "actors": quem participa da rodada, pelo nome.
 *
 * Recebe os nomes e uma função que monta o ator de cada nome: assim cada ator
 * pode ter o seu provider (um modelo diferente para o dev, por exemplo).
 */

import type { RoundActor, RoundDefinition } from '../../../src/rounds';

export const actors = <Name extends string>(
  names: readonly Name[],
  make: (name: Name) => RoundActor,
): RoundDefinition['actors'] =>
  Object.fromEntries(names.map((name) => [name, make(name)]));
