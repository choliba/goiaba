/**
 * The round as a flowchart in swimlanes: one lane per actor, one card per
 * step in the lane of who did it, and an arrow where the work passes from
 * one lane to another. Everything comes from what the round recorded: the
 * step's prompt, what was said, its tools, time, tokens and what the git
 * saw. Nobody writes anything here after the run.
 */

import type { CSSProperties, MouseEvent, ReactNode } from 'react';

import type { RoundRecord, RoundStep } from '../../../../src/rounds/types';
import {
  count,
  duration,
  providerOf,
  sumTokens,
  title,
  tokensShort,
} from '../format';

/** Lane colors, in order of the actors' first step. */
const PALETTE = ['--guava', '--violet', '--leaf', '--amber', '--sky'];

/** What passes on the arrow into `step`. */
const arrowLabel = (step: RoundStep): string =>
  step.by === null ? 'pedido' : `${title(step.by)} consulta ${step.actor}`;

function Facts({
  round,
  step,
}: {
  readonly round: RoundRecord;
  readonly step: RoundStep;
}): ReactNode {
  const checked = round.start !== null;
  const facts = [
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
  ];
  const lastSaid = step.said.at(-1)?.trim() ?? '';
  return (
    <>
      <p className="facts">{facts.join(' · ')}</p>
      {lastSaid.length > 0 && (
        <p className="quote">
          {lastSaid.slice(0, 280)}
          {lastSaid.length > 280 ? '…' : ''}
        </p>
      )}
      <details>
        <summary>Pedido, falas, ferramentas e diff</summary>
        <h4>Pedido</h4>
        <pre>{step.prompt.text}</pre>
        <h4>{count(step.said.length, 'fala', 'falas')}</h4>
        {step.said.map((said, i) => (
          <pre key={i}>{said}</pre>
        ))}
        {step.asked.length > 0 && (
          <>
            <h4>Perguntas</h4>
            {step.asked.map((asked, i) => (
              <pre key={i}>{asked}</pre>
            ))}
          </>
        )}
        {step.tools.length > 0 && (
          <>
            <h4>Ferramentas</h4>
            <ol className="tools">
              {step.tools.map((tool, i) => (
                <li key={i} className={tool.outcome}>
                  <code>{tool.name}</code> {duration(tool.span.durationMs)}
                  {tool.outcome === 'result'
                    ? ''
                    : ` · ${tool.outcome === 'error' ? 'falhou' : 'não terminou'}`}
                </li>
              ))}
            </ol>
          </>
        )}
        {step.references !== null && step.references.invalid.length > 0 && (
          <>
            <h4>Referências que não existem</h4>
            <pre>{step.references.invalid.join('\n')}</pre>
          </>
        )}
        {step.changed.length > 0 && (
          <>
            <h4>O que o git mostrou</h4>
            <pre>{step.changed.join('\n')}</pre>
            {step.diff.length > 0 && <pre className="diff">{step.diff}</pre>}
          </>
        )}
      </details>
    </>
  );
}

/**
 * A click anywhere on a step's card opens or closes its details, as the
 * summary does. Inside the details (the summary included, which toggles by
 * itself) clicks are left alone, and so is a click that ends a text
 * selection.
 */
function toggleDetails(event: MouseEvent<HTMLLIElement>): void {
  const { target, currentTarget } = event;
  if (!(target instanceof Element) || target.closest('details, a') !== null) {
    return;
  }
  if ((window.getSelection()?.toString() ?? '') !== '') return;
  const details = currentTarget.querySelector('details');
  if (details !== null) details.open = !details.open;
}

export function Flow({ round }: { readonly round: RoundRecord }): ReactNode {
  const actors = [...new Set(round.steps.map((step) => step.actor))];
  const color = (lane: string): CSSProperties => ({
    '--c': `var(${PALETTE[actors.indexOf(lane) % PALETTE.length] ?? '--muted'})`,
  });
  const columns: CSSProperties = { '--lanes': String(actors.length) };
  const column = (actor: string): number => actors.indexOf(actor) + 1;

  return (
    <section aria-label="Fluxograma da rodada" style={columns}>
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
              <li
                key={step.key}
                id={`passo-${String(index + 1)}`}
                className="scene"
                style={{
                  ...color(step.actor),
                  gridColumn: String(column(step.actor)),
                }}
                onClick={toggleDetails}
              >
                <div className="scene-head">
                  <span className="scene-num">passo {index + 1}</span>
                  <span className="scene-who">{title(step.actor)}</span>
                  <code className="scene-key">{step.key}</code>
                </div>
                <Facts round={round} step={step} />
              </li>,
            );
            return items;
          })}
          <li className="end">fim da rodada</li>
        </ol>
      </div>
    </section>
  );
}
