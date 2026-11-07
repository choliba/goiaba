/**
 * How much context a step used, against what the model can read before
 * the CLI compacts the history, and what to change in the definition when
 * it came close. Everything from the record: the step's requests (`input`,
 * the cache included) and the window the provider said it set.
 */

import type { ReactNode } from 'react';

import type { RoundRecord, RoundStep } from '../../../../src/rounds/types';
import { CONTEXT_FIXED_SHARE, CONTEXT_WARN_SHARE } from '../constants';
import { tokensShort } from '../format';

/**
 * What Claude Code says when it compacts again and again: the context
 * fills back up right after each compaction. Matched in what the agent
 * said, since the CLI reports it there.
 */
const THRASHING = /autocompact is thrashing/i;

const percent = (share: number): string =>
  `${String(Math.round(share * 100))}%`;

export function ContextUse({
  round,
  step,
  index,
}: {
  readonly round: RoundRecord;
  readonly step: RoundStep;
  readonly index: number;
}): ReactNode {
  const inputs = round.usage
    .filter((usage) => usage.step === index)
    .map((usage) => usage.tokens.input)
    .filter((input) => input !== null);
  const [first] = inputs;
  if (first === undefined) return null;
  const peak = Math.max(...inputs);
  const provider = round.actors[step.actor]?.provider;
  const window = provider?.contextWindow;
  const readable = provider?.readableContext;
  const thrashing = step.said.some((said) => THRASHING.test(said));

  if (window === undefined || readable === undefined) {
    return (
      <div className="context-use">
        <p>
          Contexto: pico de {tokensShort(peak)} tokens num pedido. A janela do
          modelo não foi registrada nesta rodada: não há com o que comparar.
        </p>
        {thrashing && <Advice fixedShare={null} thrashing />}
      </div>
    );
  }

  const share = peak / readable;
  const fixedShare = first / readable;
  const warn = thrashing || share >= CONTEXT_WARN_SHARE;
  return (
    <div className={`context-use${warn ? ' warn' : ''}`}>
      <p>
        Contexto: pico de {tokensShort(peak)} dos {tokensShort(readable)} que o
        modelo pode ler ({percent(share)})
        <meter
          min={0}
          max={1}
          high={CONTEXT_WARN_SHARE}
          value={Math.min(share, 1)}
        />
      </p>
      <p className="muted">
        Janela de {tokensShort(window)}; o resto fica para a resposta. O
        primeiro pedido, antes de qualquer trabalho, já leu {tokensShort(first)}{' '}
        ({percent(fixedShare)}): é quase só o CLI, com as instruções e as
        ferramentas dele.
      </p>
      {warn && <Advice fixedShare={fixedShare} thrashing={thrashing} />}
    </div>
  );
}

/** What to change in the definition, from what the step showed. */
function Advice({
  fixedShare,
  thrashing,
}: {
  /** The first request's share of what the model can read; null when unknown. */
  readonly fixedShare: number | null;
  readonly thrashing: boolean;
}): ReactNode {
  return (
    <div className="context-advice">
      <p>
        {thrashing
          ? 'O CLI compactou o histórico seguidas vezes: o contexto enchia logo depois de cada compactação, e o agente perdia o que tinha lido.'
          : 'O contexto chegou perto do limite: perto dele o CLI compacta o histórico, e o agente perde o que leu antes.'}{' '}
        O que fazer na definição:
      </p>
      <ul>
        <li>
          Dar mais janela ao modelo: carregá-lo com mais contexto no Ollama
          (como o <code>qwen3.5:4b-64k</code>) e dizer o mesmo ao provider, com{' '}
          <code>contextWindow: 65536</code> no <code>OllamaProvider</code>.
        </li>
        {(fixedShare === null || fixedShare >= CONTEXT_FIXED_SHARE) && (
          <li>
            Dar ao agente só as ferramentas da tarefa, com{' '}
            <code>tools: ['Read', 'Write']</code> no <code>OllamaProvider</code>
            : o conjunto completo do Claude Code custa uns 15 mil tokens em cada
            pedido.
          </li>
        )}
        <li>
          No prompt, pedir que ele leia só o necessário (o trecho, não o arquivo
          inteiro) e diga onde está o que importa, para ele não sair procurando.
        </li>
      </ul>
    </div>
  );
}
