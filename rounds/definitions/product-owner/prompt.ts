/**
 * A peça "prompt": o que o agente recebe como pedido no passo dele.
 *
 * O papel do agente e o formato do ticket; o problema vem de problem.ts.
 */

import type { RoundFlowStep } from '../../../src/rounds';
import { problem } from './problem';

export const prompt: RoundFlowStep['prompt'] = () => [
  `Você é o Product Owner.
UM especialista em negócio.
Seu trabalho é transformar um problema em um ticket.
Use linguagem livre **Não técnica
Escreva um ticket prefixado pelo número.
Escreva critérios de aceites testáveis, em Gherkin(Dado / Quando / Então).
Escreva o ticket no arquivo ticket.md.
** Este é o único assunto a ser tratado ${problem}***`.trim(),
];
