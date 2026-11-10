/**
 * A peça "rules": checagens sobre a rodada inteira, feitas depois que ela
 * termina. Perguntar elimina o agente (numa rodada ninguém responde). O
 * readOnlyRespected fica de fora: todos os atores escrevem no ticket.
 */

import { noQuestions, type RoundRule } from '../../../src/rounds';

export const rules: readonly RoundRule[] = [noQuestions()];
