/**
 * A peça "definition": a rodada montada. Só junta as peças; nenhum valor
 * mora aqui.
 */

import type { RoundDefinition } from '../../../src/rounds';
import { actors } from './actors';
import { criteria } from './criteria';
import { flow } from './flow';
import { goal } from './goal';
import { ID } from './id';
import { rules } from './rules';
import { start } from './start';

export const definition: RoundDefinition = {
  id: ID,
  goal,
  start,
  actors,
  flow,
  criteria,
  rules,
};
