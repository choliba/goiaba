/**
 * One run of a round: what it wanted to find out, what each agent cost and
 * did, the rules, how each agent was configured and what changed since the
 * run before, the flowchart, and what to look at next.
 */

import type { ReactNode } from 'react';

import {
  ActorConfigs,
  configChanges,
  promptChanges,
} from '../components/Config';
import { Flow } from '../components/Flow';
import { Rich } from '../components/Rich';
import { TestRounds } from '../components/TestRounds';
import { TestsNav } from '../components/TestsNav';
import type { Round } from '../data';
import {
  cost,
  duration,
  NOT_MEASURED,
  providerOf,
  title,
  tokens,
  when,
} from '../format';
import { roundHref } from '../route';

function Measures({ round }: { readonly round: Round }): ReactNode {
  const { record } = round;
  const rows = Object.keys(record.actors).map((name) => {
    const measures = record.measures[name];
    const total = record.totals.actors[name];
    const timing = record.timing.actors[name];
    return { name, measures, total, timing };
  });
  return (
    <section className="block" aria-labelledby="medidas">
      <h2 id="medidas">Medidas</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Agente</th>
              <th scope="col">Tempo</th>
              <th scope="col">Turnos</th>
              <th scope="col">Ferramentas</th>
              <th scope="col">Perguntas</th>
              <th scope="col">Arquivos</th>
              <th scope="col">Tokens lidos</th>
              <th scope="col">do cache</th>
              <th scope="col">Tokens escritos</th>
              <th scope="col">Custo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ name, measures, total, timing }) => (
              <tr key={name}>
                <th scope="row">
                  {title(name)}
                  <small>
                    {record.actors[name] === undefined
                      ? ''
                      : providerOf(record.actors[name])}
                  </small>
                </th>
                <td>{duration(timing?.durationMs ?? null)}</td>
                <td>{measures?.turns ?? NOT_MEASURED}</td>
                <td>{measures?.tools ?? NOT_MEASURED}</td>
                <td>{measures?.questions ?? NOT_MEASURED}</td>
                <td>
                  {record.start === null
                    ? NOT_MEASURED
                    : (measures?.changedFiles ?? NOT_MEASURED)}
                </td>
                <td>{tokens(total?.tokens.input ?? null)}</td>
                <td>{tokens(total?.tokens.cacheRead ?? null)}</td>
                <td>{tokens(total?.tokens.output ?? null)}</td>
                <td>{cost(total?.costUsd ?? null)}</td>
              </tr>
            ))}
            <tr className="total">
              <th scope="row">Rodada</th>
              <td>{duration(record.timing.durationMs)}</td>
              <td colSpan={4} />
              <td>{tokens(record.totals.round.tokens.input)}</td>
              <td>{tokens(record.totals.round.tokens.cacheRead)}</td>
              <td>{tokens(record.totals.round.tokens.output)}</td>
              <td>{cost(record.totals.round.costUsd)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="note">
        {NOT_MEASURED} é o que não foi medido: a CLI não informa (o Cursor não
        informa custo)
        {record.start === null
          ? ', ou a rodada não partiu de um ponto do git, e ninguém conferiu os arquivos'
          : ''}
        .
      </p>
    </section>
  );
}

export function RoundPage({ round }: { readonly round: Round }): ReactNode {
  const { record, label, previous, test } = round;
  const changes = previous === undefined ? [] : configChanges(record, previous);
  const prompts = previous === undefined ? [] : promptChanges(record, previous);
  const failed = record.violations.filter((v) => !v.passed);

  return (
    <main className="page">
      <TestsNav current={test.key} />

      <TestRounds test={test} current={record.id} />

      <header>
        <span className="eyebrow">
          {record.definition.id} · teste {test.number} · {label} · config.{' '}
          {round.configuration} · {when(record.timing.startedAt)}
        </span>
        <h1>
          {record.review?.title ?? `Teste ${String(test.number)}, ${label}`}
        </h1>
        <p>
          <strong>Objetivo:</strong> {record.definition.goal}
        </p>
        {record.label !== undefined && (
          <p>
            <strong>O que mudou, nas palavras de quem rodou:</strong> “
            {record.label}”
          </p>
        )}
        {record.review !== undefined && <Rich text={record.review.summary} />}
        <p className="muted">
          {record.start === null
            ? 'Sem ponto de partida no git.'
            : `Partiu da tag ${record.start.tag} (${record.start.commit}).`}{' '}
          Durou {duration(record.timing.durationMs)}.
        </p>
      </header>

      <Measures round={round} />

      <section className="block" aria-labelledby="regras">
        <h2 id="regras">Regras</h2>
        {record.violations.length === 0 ? (
          <p className="note">
            {record.start === null
              ? 'Nenhuma regra conferida: sem o git, não há como saber o que cada agente alterou.'
              : 'A rodada não declarou regras.'}
          </p>
        ) : (
          <ul className="rules">
            {record.violations.map((v, index) => (
              <li key={index} className={v.passed ? 'passed' : 'failed'}>
                <b>{v.passed ? 'cumpriu' : 'violou'}</b>
                <span>
                  <code>{v.rule}</code>
                  {v.actor === null ? '' : ` · ${v.actor}`}: {v.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
        {failed.length > 0 && (
          <p className="note warn">{failed.length} regra(s) violada(s).</p>
        )}
      </section>

      <section className="block" aria-labelledby="configuracao">
        <h2 id="configuracao">Configuração de cada agente</h2>
        <ActorConfigs round={record} />
        {previous !== undefined && (
          <div className="changes">
            <h3>
              O que mudou desde a{' '}
              <a href={roundHref(previous.id)}>rodada anterior</a>
            </h3>
            {changes.length === 0 && prompts.length === 0 ? (
              <p className="note">Nada: mesma configuração, mesmos pedidos.</p>
            ) : (
              <ul>
                {changes.map((change) => (
                  <li key={change}>
                    <code>{change}</code>
                  </li>
                ))}
                {prompts.map((actor) => (
                  <li key={actor}>
                    o pedido ao <b>{actor}</b> mudou
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <Flow round={record} />

      {record.review !== undefined && record.review.next.length > 0 && (
        <section className="next" aria-labelledby="proxima">
          <h2 id="proxima">O que olhar na próxima rodada</h2>
          <ol>
            {record.review.next.map((item) => (
              <li key={item}>
                <Rich text={item} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
