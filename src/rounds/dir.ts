/**
 * Where a round runs: its own folder in `rounds.dir` (goiaba.config.ts),
 * outside the project and recreated on every run started from a fixture.
 */

import { getConfig } from '../config/index';
import { UsageError } from '../errors';
import { join } from '../filesystem/index';

/** `<rounds.dir>/<id>`; without `rounds.dir`, a `UsageError` saying what to do. */
export function roundDir(id: string): string {
  const dir = getConfig().rounds.dir;
  if (dir === undefined) {
    throw new UsageError(
      'Configure rounds.dir no goiaba.config.ts: uma pasta fora do projeto onde as rodadas rodam, como rounds: { dir: "~/.local/share/goiaba/rodadas" }.',
    );
  }
  return join(dir, id);
}
