/**
 * A peça "workspace": onde o agente trabalha.
 *
 * Uma pasta só desta rodada, dentro de um sandbox, derivada do id (roundDir,
 * em rounds.dir). Cada passo do agente ganha um workspace novo com estas
 * opções.
 */

import type { WorkspaceOptions } from '../../../src';
import { roundDir } from '../../../src/rounds';
import { ID } from './id';

export const workspace: WorkspaceOptions = {
  // O tipo de sandbox: bubblewrap (isolamento leve, sem contêiner).
  type: 'bubblewrap',
  // A pasta da rodada, derivada do id.
  root: roundDir(ID),
  // Nada do host entra: o agente só enxerga a pasta da rodada.
  hostState: 'none',
};
