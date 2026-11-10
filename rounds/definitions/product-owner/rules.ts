/**
 * A peça "rules": checagens sobre a rodada inteira, feitas de fora dos
 * agentes depois que ela termina.
 *
 * Perguntar elimina o agente (numa rodada ninguém responde). O
 * readOnlyRespected fica de fora: o agente deve escrever.
 */

import { noQuestions, type RoundRule } from '../../../src/rounds';

export const rules: readonly RoundRule[] = [noQuestions()];
