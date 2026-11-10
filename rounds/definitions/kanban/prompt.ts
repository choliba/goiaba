/**
 * A peça "prompt": a instrução que cada ator recebe, a mesma do fluxo
 * ("INSTRUCAO PARA CADA AGENTE"), com o nome do ator.
 *
 * O ator que não está na vez responde uma linha e não mexe em nada: uma
 * resposta vazia faz a rodada parar. Um ator pode receber um recado só dele
 * (`briefs`): a demanda do solicitante, a tarefa do dev.
 */

import type { RoundFlowStep } from '../../../src/rounds';
import type { ActorName } from './actors-names';

export interface PromptParams {
  /** O que só um ator recebe, depois da instrução comum. */
  readonly briefs?: Partial<Readonly<Record<ActorName, string>>>;
}

export const prompt =
  (
    actor: ActorName,
    { briefs = {} }: PromptParams = {},
  ): RoundFlowStep['prompt'] =>
  () => {
    const brief = briefs[actor];
    return [
      `Voce e o ator ${actor}. Leia fluxo.txt e ticket.txt.`,
      `Se PROXIMO_ATOR no ticket nao for ${actor}, nao altere nenhum arquivo e responda apenas: "Nao e a vez de ${actor}."`,
      `Caso contrario, preencha apenas a secao com "dono: ${actor}" usando`,
      'as opcoes definidas no fluxo, marque [x] no que foi feito, aplique',
      'a transicao correspondente no cabecalho e acrescente uma linha',
      'ao HISTORICO. No fim, responda em uma linha o que voce fez.',
      'Ninguem vai responder perguntas: decida sozinho.',
      ...(brief === undefined ? [] : ['', brief]),
    ];
  };
