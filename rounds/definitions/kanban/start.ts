/**
 * A peça "start": de onde cada execução parte.
 *
 * Recebe o nome de uma pasta de rounds/fixtures. A pasta da rodada é apagada
 * e recebe uma cópia dela, com um repositório git novo.
 */

import type { RoundStartDefinition } from '../../../src/rounds';

export const start = (fixture: string): RoundStartDefinition => ({ fixture });
