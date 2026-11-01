/**
 * Pergunta e resposta entre você e um modelo do Ollama, direto pela API
 * (sem CLI e sem sandbox), com ferramentas que o modelo pode chamar:
 * - `add` e `multiply`: contas;
 * - `choice`: o modelo pergunta e você escolhe uma opção com uma tecla.
 *
 *   bun agents/meus-testes/ollama.chat.ts
 *
 * Digite uma pergunta e Enter; `sair` (ou uma linha vazia) encerra, e
 * Ctrl+C também. A conversa inteira vai em cada pedido: o modelo lembra do
 * que já foi dito.
 */

import ollama, { type Message, type Tool, type ToolCall } from 'ollama';

import { StandardOutput } from '../../src/output/index';
import { runScript } from '../../src/usage';

/** Precisa de `tools` no `ollama show` (o d1-omni:600m só tem `decision`). */
const MODEL = 'qwen3.5:4b';

const SYSTEM = `Você é um assistente que conversa em português, de forma curta.
Para contas, use as ferramentas add e multiply em vez de calcular de cabeça.
Quando precisar que o usuário decida entre alternativas, use a ferramenta
choice em vez de perguntar em texto.`;

/** Uma tecla por opção: 1 a 9. */
const MAX_OPTIONS = 9;

const tools: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'add',
      description: 'Soma dois números',
      parameters: {
        type: 'object',
        required: ['a', 'b'],
        properties: {
          a: { type: 'number', description: 'O primeiro número' },
          b: { type: 'number', description: 'O segundo número' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'multiply',
      description: 'Multiplica dois números',
      parameters: {
        type: 'object',
        required: ['a', 'b'],
        properties: {
          a: { type: 'number', description: 'O primeiro número' },
          b: { type: 'number', description: 'O segundo número' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'choice',
      description:
        'Pergunta ao usuário e espera ele escolher uma das opções. Devolve a opção escolhida.',
      parameters: {
        type: 'object',
        required: ['question', 'options'],
        properties: {
          question: { type: 'string', description: 'A pergunta ao usuário' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: `As opções, de 2 a ${String(MAX_OPTIONS)}`,
          },
        },
      },
    },
  },
];

const functions = new Map<string, (a: number, b: number) => number>([
  ['add', (a, b) => a + b],
  ['multiply', (a, b) => a * b],
]);

const terminal = new StandardOutput();

/** Mostra a pergunta e as opções numeradas; você responde com uma tecla. */
async function choose(
  question: unknown,
  options: unknown,
  signal: AbortSignal,
): Promise<string> {
  if (typeof question !== 'string' || !Array.isArray(options)) {
    return 'Passe question (texto) e options (lista de textos).';
  }
  const labels = options.filter(
    (option: unknown): option is string => typeof option === 'string',
  );
  if (labels.length < 2 || labels.length > MAX_OPTIONS) {
    return `Passe de 2 a ${String(MAX_OPTIONS)} opções.`;
  }

  terminal.write(`\n${question}`);
  labels.forEach((label, index) => {
    terminal.write(`  [${String(index + 1)}] ${label}`);
  });
  terminal.write('Escolha:');

  const keys = labels.map((_, index) => String(index + 1));
  for (;;) {
    const key = await terminal.choose(keys, signal);
    const index = keys.indexOf(key);
    if (index !== -1) return `O usuário escolheu: ${labels[index]}`;
    terminal.write(`Use uma tecla de 1 a ${String(labels.length)}:`);
  }
}

/** Roda uma chamada de ferramenta; o texto volta para o modelo. */
async function runTool(call: ToolCall, signal: AbortSignal): Promise<string> {
  const args = call.function.arguments;
  if (call.function.name === 'choice') {
    return choose(args['question'], args['options'], signal);
  }

  const fn = functions.get(call.function.name);
  const { a, b } = args;
  if (fn === undefined) return `Ferramenta desconhecida: ${call.function.name}`;
  if (typeof a !== 'number' || typeof b !== 'number') {
    return 'Os argumentos a e b precisam ser números.';
  }
  return String(fn(a, b));
}

/**
 * Uma resposta do modelo à sua pergunta. Enquanto ele pedir ferramentas,
 * roda e devolve o resultado; termina quando ele responde em texto.
 */
async function answer(messages: Message[], signal: AbortSignal): Promise<void> {
  for (;;) {
    const { message } = await ollama.chat({
      model: MODEL,
      messages,
      tools,
      think: false,
    });
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      terminal.write(`agente: ${message.content}`);
      return;
    }

    for (const call of calls) {
      const result = await runTool(call, signal);
      // A escolha você já viu; as contas aparecem como chamada e resultado.
      if (call.function.name !== 'choice') {
        terminal.write(
          `  (${call.function.name} ${JSON.stringify(call.function.arguments)} = ${result})`,
        );
      }
      messages.push({
        role: 'tool',
        tool_name: call.function.name,
        content: result,
      });
    }
  }
}

await runScript(
  async ({ signal }) => {
    const messages: Message[] = [{ role: 'system', content: SYSTEM }];
    terminal.write(`Conversa com ${MODEL}. Digite "sair" para encerrar.`);

    for (;;) {
      terminal.write('\nvocê:');
      const question = (await terminal.ask('', signal)).trim();
      if (question === '' || question.toLowerCase() === 'sair') break;

      messages.push({ role: 'user', content: question });
      await answer(messages, signal);
    }
  },
  { output: terminal },
);

terminal.close();
