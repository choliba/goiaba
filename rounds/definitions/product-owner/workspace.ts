import type { WorkspaceOptions } from '../../../src';
import { roundDir } from '../../../src/rounds';

export const workspace = (id: string): WorkspaceOptions => ({
  type: 'bubblewrap',
  root: roundDir(id),
  hostState: 'none',
});
