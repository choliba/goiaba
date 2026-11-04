/**
 * The round as a flowchart in swimlanes: one lane per actor (and one for a
 * person, when someone answered), each scene in the lane of who acts, and
 * arrows where the work passes from one lane to another. The scenes come
 * from the review; the facts of each step (time, tools, tokens, what the git
 * saw) come from the record. A step the review does not cover still gets a
 * card, with the facts only.
 */

import type { CSSProperties, ReactNode } from 'react';

import type {
  RoundRecord,
  RoundStep,
  StepReview,
} from '../../../../src/rounds/types';
import {
  count,
  duration,
  providerOf,
  sumTokens,
  title,
  tokensShort,
} from '../format';
import { totalOf } from '../../../../src/rounds/totals';
import { Rich } from './Rich';

/** The lane of a person answering. */
const YOU = 'you';

/** Lane colors, in order of the actors' first step. */
const PALETTE = ['--guava', '--violet', '--leaf', '--amber', '--sky'];

interface Card {
  readonly kind: 'card';
  /** `null`: the script speaking, across every lane. */
  readonly lane: string | null;
  readonly scene: StepReview | undefined;
  /** The step whose facts this card shows (its first card). */
  readonly step: number | undefined;
}

interface Arrow {
  readonly kind: 'arrow';
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

const laneOf = (
  scene: StepReview,
  steps: readonly RoundStep[],
): string | null =>
  scene.lane ??
  (scene.step === null ? null : (steps[scene.step]?.actor ?? null));

/** The cards in order: the review's scenes, plus a card for each step it left out. */
function cards(round: RoundRecord): Card[] {
  const { steps } = round;
  const scenes = round.review?.steps ?? [];
  const result: Card[] = [];
  const shown = new Set<number>();
  const showUpTo = (last: number): void => {
    for (let index = 0; index <= last; index += 1) {
      if (shown.has(index)) continue;
      shown.add(index);
      result.push({
        kind: 'card',
        lane: steps[index]?.actor ?? null,
        scene: undefined,
        step: index,
      });
    }
  };
  for (const scene of scenes) {
    const { step } = scene;
    if (step !== null) showUpTo(step - 1);
    const first = step !== null && !shown.has(step);
    if (step !== null) shown.add(step);
    result.push({
      kind: 'card',
      lane: laneOf(scene, steps),
      scene,
      step: first ? step : undefined,
    });
  }
  showUpTo(steps.length - 1);
  return result;
}

/** What passes on an arrow into `card`. */
function label(from: string, card: Card, round: RoundRecord): string {
  if (card.lane === YOU) return 'pergunta';
  if (from === YOU) return 'resposta';
  if (card.step === undefined) return '';
  const step = round.steps[card.step];
  if (step === undefined) return '';
  return step.by === null
    ? 'pedido'
    : `${title(step.by)} consulta ${step.actor}`;
}

function withArrows(
  list: readonly Card[],
  round: RoundRecord,
): (Card | Arrow)[] {
  const result: (Card | Arrow)[] = [];
  let last: string | null = null;
  for (const card of list) {
    if (card.lane !== null && last !== null && last !== card.lane) {
      result.push({
        kind: 'arrow',
        from: last,
        to: card.lane,
        label: label(last, card, round),
      });
    }
    if (card.lane !== null) last = card.lane;
    result.push(card);
  }
  return result;
}

function Facts({
  round,
  index,
}: {
  readonly round: RoundRecord;
  readonly index: number;
}): ReactNode {
  const step = round.steps[index];
  if (step === undefined) return null;
  const usage = totalOf(
    round.usage.filter(
      (u) =>
        u.actor === step.actor &&
        u.ts >= step.span.startedAt &&
        u.ts <= step.span.endedAt,
    ),
  );
  const checked = round.start !== null;
  const facts = [
    duration(step.span.durationMs),
    count(step.turns.length, 'turno', 'turnos'),
    count(step.tools.length, 'ferramenta', 'ferramentas'),
    `${tokensShort(sumTokens(usage.tokens))} tokens`,
    ...(step.asked.length > 0
      ? [count(step.asked.length, 'pergunta', 'perguntas')]
      : []),
    checked
      ? step.changed.length === 0
        ? 'não alterou arquivos'
        : count(step.changed.length, 'arquivo alterado', 'arquivos alterados')
      : 'alterações não conferidas',
  ];
  return (
    <>
      <p className="facts">{facts.join(' · ')}</p>
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

export function Flow({ round }: { readonly round: RoundRecord }): ReactNode {
  const list = cards(round);
  const actors = [...new Set(round.steps.map((step) => step.actor))];
  const lanes = [
    ...(list.some((card) => card.lane === YOU) ? [YOU] : []),
    ...actors,
  ];
  const color = (lane: string): CSSProperties => ({
    '--c': `var(${lane === YOU ? '--you' : (PALETTE[actors.indexOf(lane) % PALETTE.length] ?? '--muted')})`,
  });
  const name = (lane: string): string => (lane === YOU ? 'Você' : title(lane));
  const columns: CSSProperties = { '--lanes': String(lanes.length) };
  let sceneNumber = 0;

  return (
    <section aria-label="Fluxograma da rodada" style={columns}>
      <div className="lanes" aria-hidden="true">
        {lanes.map((lane) => (
          <div key={lane} className="lane-head" style={color(lane)}>
            <b>{name(lane)}</b>
            <span>
              {lane === YOU
                ? 'quem respondeu'
                : round.actors[lane] === undefined
                  ? ''
                  : providerOf(round.actors[lane])}
            </span>
          </div>
        ))}
      </div>
      <div className="flow-wrap">
        <div className="guides" aria-hidden="true">
          {lanes.map((lane) => (
            <i key={lane} />
          ))}
        </div>
        <ol className="flow">
          {withArrows(list, round).map((item, index) => {
            if (item.kind === 'arrow') {
              const a = lanes.indexOf(item.from) + 1;
              const b = lanes.indexOf(item.to) + 1;
              const span = Math.abs(a - b) + 1;
              return (
                <li
                  key={index}
                  className={`handoff ${a < b ? 'ltr' : 'rtl'}`}
                  style={{
                    gridColumn: `${String(Math.min(a, b))} / ${String(Math.max(a, b) + 1)}`,
                  }}
                  aria-label={`${name(item.from)} para ${name(item.to)}${item.label === '' ? '' : `: ${item.label}`}`}
                >
                  <i
                    className="line"
                    style={{
                      left: `${String(50 / span)}%`,
                      right: `${String(50 / span)}%`,
                    }}
                  />
                  {item.label !== '' && (
                    <span className="desktop-label">{item.label}</span>
                  )}
                  <span className="mobile-label">
                    ↓ {name(item.from)} → {name(item.to)}
                    {item.label === '' ? '' : ` · ${item.label}`}
                  </span>
                </li>
              );
            }
            sceneNumber += 1;
            const { scene, lane, step } = item;
            const facts = step === undefined ? undefined : round.steps[step];
            const heading =
              scene?.title !== undefined && scene.title.length > 0
                ? scene.title
                : facts !== undefined
                  ? `${title(facts.actor)} trabalha`
                  : '';
            return (
              <li
                key={index}
                id={`cena-${String(sceneNumber)}`}
                className={`scene${lane === null ? ' script' : ''}${scene?.warn === undefined ? '' : ' warn'}${lane === YOU ? ' you-line' : ''}`}
                style={
                  lane === null
                    ? { gridColumn: '1 / -1' }
                    : {
                        ...color(lane),
                        gridColumn: String(lanes.indexOf(lane) + 1),
                      }
                }
              >
                <div className="scene-head">
                  <span className="scene-num">cena {sceneNumber}</span>
                  <span className="scene-who">
                    {lane === null ? 'script' : name(lane)}
                  </span>
                  {heading.length > 0 && <h3>{heading}</h3>}
                </div>
                {scene?.text !== undefined && <Rich text={scene.text} />}
                {step !== undefined && <Facts round={round} index={step} />}
                {scene?.ok !== undefined && (
                  <div className="flag ok">
                    <b>certo</b>
                    <span>
                      <Rich text={scene.ok} />
                    </span>
                  </div>
                )}
                {scene?.warn !== undefined && (
                  <div className="flag">
                    <b>atenção</b>
                    <span>
                      <Rich text={scene.warn} />
                    </span>
                  </div>
                )}
              </li>
            );
          })}
          <li className="end">fim da rodada</li>
        </ol>
      </div>
    </section>
  );
}
