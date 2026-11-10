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
import { CopyDeclaration } from '../components/CopyDeclaration';
import { Flow } from '../components/Flow';
import { Resources } from '../components/Resources';
import { Rules } from '../components/Rules';
import { Scores } from '../components/Scores';
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
  goalOf,
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

  return (
    <main className="page">
      <TestsNav current={test.key} />

      <TestRounds test={test} current={record.id} />

      <header>
        <span className="eyebrow">
          {record.definition.id} · {label} · config. {round.configuration} ·{' '}
          {when(record.timing.startedAt)}
        </span>
        <h1>Rodada {round.index}</h1>
        <p>
          <strong>Objetivo:</strong> {goalOf(record.definition.goal)}
        </p>
        {record.label !== undefined && (
          <p>
            <strong>O que mudou, nas palavras de quem rodou:</strong> “
            {record.label}”
          </p>
        )}
        <p className="muted">
          {record.start === null
            ? 'Sem ponto de partida no git.'
            : record.start.fixture === undefined ||
                record.start.fixture === null
              ? `Partiu da tag ${record.start.tag} (${record.start.commit}).`
              : `Partiu da fixture ${record.start.fixture} (tag ${record.start.tag}, ${record.start.commit}).`}{' '}
          Durou {duration(record.timing.durationMs)}.
        </p>
        {record.declaration !== undefined && (
          <CopyDeclaration declaration={record.declaration} />
        )}
      </header>

      <Scores score={round.score} record={round.record} />

      <Measures round={round} />

      <Resources round={round} />

      <Rules record={record} />

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
    </main>
  );
}
