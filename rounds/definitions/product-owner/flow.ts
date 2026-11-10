/**
 * A peça "flow": os passos da rodada, em ordem. Aqui, um só.
 */

import type { RoundFlowStep } from '../../../src/rounds';
import { PRODUCT_OWNER } from './actor-name';
import { prompt } from './prompt';

export const flow: readonly RoundFlowStep[] = [
  {
    // Quem age neste passo.
    actor: PRODUCT_OWNER,
    // O que ele recebe como pedido.
    prompt,
  },
];
