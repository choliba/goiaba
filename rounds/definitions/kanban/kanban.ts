/**
 * A entrada da rodada: o arquivo que `bun run rounds kanban` encontra
 * (rounds/definitions/<id>/<id>.ts). defineRound confere a declaração.
 */

import { defineRound } from '../../../src/rounds';
import { definition } from './definition';

export default defineRound(definition);
