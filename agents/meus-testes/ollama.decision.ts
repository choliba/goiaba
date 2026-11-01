/**
 * Modelos de decisão do Ollama (capability `decision`, como o d1-omni):
 * eles não conversam, respondem perguntas fechadas sobre um texto.
 *
 *   bun agents/meus-testes/ollama.decision.ts
 *
 * Você digita a mensagem de um cliente; o modelo responde às perguntas
 * abaixo, uma de cada tipo. `sair` (ou uma linha vazia) encerra.
 *
 * Tipos de pergunta (https://docs.ollama.com/capabilities/decision):
 * - `choice`: escolhe uma das opções (2 a 26), com a probabilidade de cada;
 * - `noul`:   sim ou não, como a probabilidade de "sim" (0 a 1);
 * - `score`:  nota numa escala ordenada (2 a 10 níveis, do menor ao maior).
 *
 * Usa `ollama.systemone` (POST /v1/systemone), não `ollama.chat`. Precisa
 * do Ollama 0.35.0 ou mais novo.
 */

import ollama, { type SystemOneAnswer, type SystemOneQuestion } from 'ollama';

import { StandardOutput } from '../../src/output/index';
import { runScript } from '../../src/usage';

const MODEL = 'd1-omni:600m';

const questions: Record<string, SystemOneQuestion> = {
  intent: {
    type: 'choice',
    instructions:
      'Which listed support intent best matches the customer message?',
    criteria: {
      duplicate_charge: 'The customer reports being charged more than once.',
      cancel_subscription:
        'The customer wants to end or downgrade a subscription.',
      card_declined:
        'The customer reports a payment that failed or was declined.',
      none: 'None of the listed intents matches.',
    },
  },
  refund: {
    type: 'noul',
    instructions: 'Does the customer explicitly ask for a refund?',
  },
  urgency: {
    type: 'score',
    instructions: 'How urgently does this message need a response?',
    criteria: [
      'Routine: no time pressure',
      'Soon: a customer is inconvenienced',
      'Immediate: a critical service is unavailable',
    ],
  },
};

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** Uma resposta em uma linha, conforme o tipo da pergunta. */
function describe(name: string, answer: SystemOneAnswer): string {
  if (answer.type === 'choice') {
    return `${name}: ${answer.choice} (confiança ${percent(answer.confidence)})`;
  }
  if (answer.type === 'noul') {
    return `${name}: ${percent(answer.noul)} de chance de ser "sim"`;
  }
  // A nota é a média ponderada dos níveis (0, 1, 2…): mostra o mais próximo.
  const level = answer.legend[String(Math.round(answer.score))];
  return `${name}: ${answer.score.toFixed(2)} → ${level}`;
}

const terminal = new StandardOutput();

await runScript(
  async ({ signal }) => {
    terminal.write(
      `Decisões com ${MODEL}. Digite a mensagem de um cliente ("sair" encerra).`,
    );

    for (;;) {
      terminal.write('\ncliente:');
      const message = (await terminal.ask('', signal)).trim();
      if (message === '' || message.toLowerCase() === 'sair') break;

      const { answers } = await ollama.systemone({
        model: MODEL,
        state: message,
        questions,
      });
      for (const [name, answer] of Object.entries(answers)) {
        terminal.write(`  ${describe(name, answer)}`);
      }
    }
  },
  { output: terminal },
);

terminal.close();
