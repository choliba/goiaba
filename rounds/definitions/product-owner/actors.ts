/**
 * A peça "actors": quem participa da rodada, pelo nome. Aqui, um agente só.
 */

import type { RoundDefinition } from '../../../src/rounds';
import { actor } from './actor';
import { PRODUCT_OWNER } from './actor-name';

export const actors: RoundDefinition['actors'] = {
  [PRODUCT_OWNER]: actor,
};
