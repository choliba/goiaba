/**
 * A peça "workspace": onde os atores trabalham.
 *
 * A pasta da rodada, derivada do id (roundDir, em rounds.dir), dentro de um
 * sandbox. Todos os atores trabalham na mesma pasta: o ticket.txt é o quadro
 * que eles compartilham.
 */

import type { WorkspaceOptions } from '../../../src';
import { roundDir } from '../../../src/rounds';

export const workspace = (id: string): WorkspaceOptions => ({
  // O tipo de sandbox: bubblewrap (isolamento leve, sem contêiner).
  type: 'bubblewrap',
  root: roundDir(id),
  // Nada do host entra: o agente só enxerga a pasta da rodada.
  hostState: 'none',
});
