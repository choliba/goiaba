/**
 * The round as a flowchart in swimlanes: one lane per actor, one card per
 * step in the lane of who did it, and an arrow where the work passes from
 * one lane to another. Everything comes from what the round recorded: the
 * step's prompt, what was said, its tools, time, tokens and what the git
 * saw. Nobody writes anything here after the run. A card says the step in
 * short; a click opens all of it in a modal.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';

import type { RoundRecord, RoundStep } from '../../../../src/rounds/types';
import {
  count,
  duration,
  providerOf,
  sumTokens,
  title,
  tokensShort,
} from '../format';
import { ContextUse } from './ContextUse';
import { Modal } from './Modal';
import { Badge } from './Status';
import { ToolList } from './ToolList';

/** Lane colors, in order of the actors' first step. */
const PALETTE = ['--guava', '--violet', '--leaf', '--amber', '--sky'];

/** What passes on the arrow into `step`. */
const arrowLabel = (step: RoundStep): string =>
  step.by === null ? 'pedido' : `${title(step.by)} consulta ${step.actor}`;

/** The step's facts in one line: time, turns, tools, tokens, questions, files. */
function factsOf(round: RoundRecord, step: RoundStep): string {
  const checked = round.start !== null;
  return [
    duration(step.span.durationMs),
    count(step.turns.length, 'turno', 'turnos'),
    count(step.tools.length, 'ferramenta', 'ferramentas'),
    `${tokensShort(sumTokens(step.totals.tokens))} tokens`,
    ...(step.asked.length > 0
      ? [count(step.asked.length, 'pergunta', 'perguntas')]
      : []),
    checked
      ? step.changed.length === 0
        ? 'não alterou arquivos'
        : count(step.changed.length, 'arquivo alterado', 'arquivos alterados')
      : 'alterações não conferidas',
  ].join(' · ');
}

/** Everything about one step, organized: what its modal shows. */
function StepDetails({
  round,
  step,
  index,
}: {
  readonly round: RoundRecord;
  readonly step: RoundStep;
  readonly index: number;
}): ReactNode {
  return (
    <div className="step-details">
      <p className="facts">{factsOf(round, step)}</p>
      <ContextUse round={round} step={step} index={index} />
      <section>
        <h3>Pedido</h3>
        <pre>{step.prompt.text}</pre>
      </section>
      <section>
        <h3>{count(step.said.length, 'fala', 'falas')}</h3>
        {step.said.map((said, i) => (
          <pre key={i}>{said}</pre>
        ))}
      </section>
      {step.asked.length > 0 && (
        <section>
          <h3>
            Perguntas <Badge status="danger">{step.asked.length}</Badge>
          </h3>
          {step.asked.map((asked, i) => (
            <pre key={i}>{asked}</pre>
          ))}
        </section>
      )}
      {step.tools.length > 0 && (
        <ToolList heading="Ferramentas" tools={step.tools} />
      )}
      {step.references !== null && step.references.invalid.length > 0 && (
        <section>
          <h3>Referências que não existem</h3>
          <pre>{step.references.invalid.join('\n')}</pre>
        </section>
      )}
      {step.changed.length > 0 && (
        <section>
          <h3>O que o git mostrou</h3>
          <pre>{step.changed.join('\n')}</pre>
          {step.diff.length > 0 && <pre className="diff">{step.diff}</pre>}
        </section>
      )}
    </div>
  );
}

/**
 * One step in its lane, in short: who, its facts, how many tools failed and
 * the start of what it said. The whole card opens the step in a modal.
 */
function StepCard({
  round,
  step,
  index,
  style,
}: {
  readonly round: RoundRecord;
  readonly step: RoundStep;
  readonly index: number;
  readonly style: CSSProperties;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const lastSaid = step.said.at(-1)?.trim() ?? '';
  const failed = step.tools.filter((tool) => tool.outcome === 'error').length;
  return (
    <li id={`passo-${String(index + 1)}`} className="scene" style={style}>
      <button
        type="button"
        className="scene-open"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="scene-head">
          <span className="scene-num">passo {index + 1}</span>
          <span className="scene-who">{title(step.actor)}</span>
          <code className="scene-key">{step.key}</code>
        </span>
        <span className="facts">{factsOf(round, step)}</span>
        {(failed > 0 || step.asked.length > 0) && (
          <span className="scene-badges">
            {failed > 0 && (
              <Badge status="danger">
                {count(failed, 'ferramenta com erro', 'ferramentas com erro')}
              </Badge>
            )}
            {step.asked.length > 0 && (
              <Badge status="danger">
                {count(step.asked.length, 'pergunta', 'perguntas')}
              </Badge>
            )}
          </span>
        )}
        {lastSaid.length > 0 && <span className="quote">{lastSaid}</span>}
      </button>
      <Modal
        title={`Passo ${String(index + 1)}: ${title(step.actor)}`}
        open={open}
        onClose={() => setOpen(false)}
        wide
      >
        <StepDetails round={round} step={step} index={index} />
      </Modal>
    </li>
  );
}

export function Flow({ round }: { readonly round: RoundRecord }): ReactNode {
  const actors = [...new Set(round.steps.map((step) => step.actor))];
  const color = (lane: string): CSSProperties => ({
    '--c': `var(${PALETTE[actors.indexOf(lane) % PALETTE.length] ?? '--muted'})`,
  });
  const columns: CSSProperties = { '--lanes': String(actors.length) };
  const column = (actor: string): number => actors.indexOf(actor) + 1;

  return (
    <section className="block" aria-labelledby="fluxo" style={columns}>
      <h2 id="fluxo">Fluxo da rodada</h2>
      <p className="note">
        Os passos do <code>flow</code> da definição, na ordem em que rodaram:
        uma coluna por agente, um card por passo, e uma seta quando o trabalho
        passa de um agente a outro. Clique num card para ver o pedido, as falas,
        as ferramentas e o que o git mostrou.
      </p>
      <div className="lanes" aria-hidden="true">
        {actors.map((actor) => {
          const snapshot = round.actors[actor];
          return (
            <div key={actor} className="lane-head" style={color(actor)}>
              <b>{title(actor)}</b>
              <span>{snapshot === undefined ? '' : providerOf(snapshot)}</span>
            </div>
          );
        })}
      </div>
      <div className="flow-wrap">
        <div className="guides" aria-hidden="true">
          {actors.map((actor) => (
            <i key={actor} />
          ))}
        </div>
        <ol className="flow">
          {round.steps.flatMap((step, index) => {
            const previous = round.steps[index - 1];
            const items: ReactNode[] = [];
            if (previous !== undefined && previous.actor !== step.actor) {
              const a = column(previous.actor);
              const b = column(step.actor);
              const span = Math.abs(a - b) + 1;
              const label = arrowLabel(step);
              items.push(
                <li
                  key={`arrow-${String(index)}`}
                  className={`handoff ${a < b ? 'ltr' : 'rtl'}`}
                  style={{
                    gridColumn: `${String(Math.min(a, b))} / ${String(Math.max(a, b) + 1)}`,
                  }}
                  aria-label={`${title(previous.actor)} para ${title(step.actor)}: ${label}`}
                >
                  <i
                    className="line"
                    style={{
                      left: `${String(50 / span)}%`,
                      right: `${String(50 / span)}%`,
                    }}
                  />
                  <span className="desktop-label">{label}</span>
                  <span className="mobile-label">
                    ↓ {title(previous.actor)} → {title(step.actor)} · {label}
                  </span>
                </li>,
              );
            }
            items.push(
              <StepCard
                key={step.key}
                round={round}
                step={step}
                index={index}
                style={{
                  ...color(step.actor),
                  gridColumn: String(column(step.actor)),
                }}
              />,
            );
            return items;
          })}
          <li className="end">fim da rodada</li>
        </ol>
      </div>
    </section>
  );
}
