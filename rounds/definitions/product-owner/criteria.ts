/**
 * A peça "criteria": o que a rodada confere sozinha no fim de cada passo,
 * para medir a eficácia (o "Critérios do prompt" na nota).
 *
 * Aqui estão só os critérios REAIS desta rodada. O catálogo com TODAS as
 * opções de critério (file/limit/condicional e seus campos) está no plano
 * criteria-linguagem-natural.md e nos tipos de src/rounds.
 */

import type { RoundCriteria } from '../../../src/rounds';
import { PRODUCT_OWNER } from './actor-name';

export const criteria: RoundCriteria = {
  // Os critérios do Product Owner, conferidos no fim do passo dele.
  [PRODUCT_OWNER]: [
    // O ticket precisa estar escrito em ticket.md e conter o "Então" do
    // Gherkin e a cor pedida no problema (maiúsculas/minúsculas não importam).
    { file: { name: 'ticket.md', contains: ['Então', '#5f4e4e'] } },
  ],
};
