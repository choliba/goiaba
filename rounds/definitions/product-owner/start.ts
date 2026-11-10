/**
 * A peça "start": de onde cada execução parte.
 *
 * Cada execução parte de uma cópia de rounds/fixtures/site-vazio (index.html,
 * ticket.txt, README.md); a pasta da rodada é apagada antes.
 */

import type { RoundStartDefinition } from '../../../src/rounds';

// @FIX: a fixture poderia trazer mais informações além do nome da pasta.
export const start: RoundStartDefinition = {
  // A pasta em rounds/fixtures que vira o ponto de partida.
  fixture: 'site-vazio',
};
