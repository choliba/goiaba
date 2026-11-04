/**
 * A test: one configuration and every round it ran. The measures of all its
 * rounds side by side (one round alone says little), how each agent was
 * configured, what changed since the test before, and a link to each round.
 */

import type { ReactNode } from 'react';

import type { RoundRecord } from '../../../../src/rounds/types';

import {
  ActorConfigs,
  configChanges,
  promptChanges,
} from '../components/Config';
import { Rich } from '../components/Rich';
import { TestRounds } from '../components/TestRounds';
import { TestsNav } from '../components/TestsNav';
import type { Test } from '../data';
import {
  cost,
  count,
  duration,
  providerOf,
  title,
  tokensShort,
  when,
} from '../format';
import { roundHref, testHref } from '../route';
import {
  changedFiles,
  decimal,
  ranged,
  roundTokens,
  rulesOf,
  testRules,
} from '../summary';

export function TestPage({ test }: { readonly test: Test }): ReactNode {
  const records = test.rounds.map((round) => round.record);
  const first = records[0];
  if (first === undefined) return null;
  const previous = test.previous?.rounds[0]?.record;
  const changes = previous === undefined ? [] : configChanges(first, previous);
  const prompts = previous === undefined ? [] : promptChanges(first, previous);
  const several = records.length > 1;
  /** One value per round. */
  const of = <T,>(pick: (record: RoundRecord) => T): T[] => records.map(pick);

  return (
    <main className="page">
      <TestsNav current={test.key} />

      <TestRounds test={test} />

      <header>
        <span className="eyebrow">
          {test.definition.id} · teste {test.number} ·{' '}
          {count(records.length, 'rodada', 'rodadas')}
        </span>
        <h1>{test.title}</h1>
        <p>
          <strong>Objetivo:</strong> {test.definition.goal}
        </p>
        {first.review !== undefined && <Rich text={first.review.summary} />}
      </header>

      <section className="block" aria-labelledby="rodadas">
        <h2 id="rodadas">Rodadas</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Rodada</th>
                <th scope="col">Data</th>
                <th scope="col">Tempo</th>
                <th scope="col">Tokens</th>
                <th scope="col">Custo</th>
                <th scope="col">Arquivos alterados</th>
                <th scope="col">Regras</th>
              </tr>
            </thead>
            <tbody>
              {test.rounds.map((round) => (
                <tr key={round.record.id}>
                  <th scope="row">
                    <a href={roundHref(round.record.id)}>
                      <small>{round.label}</small>
                      {round.record.review?.title ??
                        `Rodada ${String(round.index)}`}
                    </a>
                  </th>
                  <td>{when(round.record.timing.startedAt)}</td>
                  <td>{duration(round.record.timing.durationMs)}</td>
                  <td>{tokensShort(roundTokens(round.record))}</td>
                  <td>{cost(round.record.totals.round.costUsd)}</td>
                  <td>{changedFiles(round.record) ?? 'não conferido'}</td>
                  <td>{rulesOf(round.record)}</td>
                </tr>
              ))}
              {several && (
                <tr className="total">
                  <th scope="row">Média (menor – maior)</th>
                  <td />
                  <td>
                    {ranged(
                      records.map((r) => r.timing.durationMs),
                      duration,
                    )}
                  </td>
                  <td>{ranged(records.map(roundTokens), tokensShort)}</td>
                  <td>
                    {ranged(
                      records.map((r) => r.totals.round.costUsd),
                      cost,
                    )}
                  </td>
                  <td>{ranged(records.map(changedFiles), decimal)}</td>
                  <td>{testRules(test)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block" aria-labelledby="agentes">
        <h2 id="agentes">Cada agente{several ? ', em média' : ''}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Agente</th>
                <th scope="col">Tempo</th>
                <th scope="col">Turnos</th>
                <th scope="col">Ferramentas</th>
                <th scope="col">Perguntas</th>
                <th scope="col">Tokens</th>
                <th scope="col">Custo</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(first.actors).map(([name, actor]) => {
                return (
                  <tr key={name}>
                    <th scope="row">
                      {title(name)}
                      <small>{providerOf(actor)}</small>
                    </th>
                    <td>
                      {ranged(
                        of((r) => r.timing.actors[name]?.durationMs ?? null),
                        duration,
                      )}
                    </td>
                    <td>
                      {ranged(
                        of((r) => r.measures[name]?.turns ?? null),
                        decimal,
                      )}
                    </td>
                    <td>
                      {ranged(
                        of((r) => r.measures[name]?.tools ?? null),
                        decimal,
                      )}
                    </td>
                    <td>
                      {ranged(
                        of((r) => r.measures[name]?.questions ?? null),
                        decimal,
                      )}
                    </td>
                    <td>
                      {ranged(
                        of((r) => {
                          const tokens = r.totals.actors[name]?.tokens;
                          return tokens === undefined ||
                            (tokens.input === null && tokens.output === null)
                            ? null
                            : (tokens.input ?? 0) + (tokens.output ?? 0);
                        }),
                        tokensShort,
                      )}
                    </td>
                    <td>
                      {ranged(
                        of((r) => r.totals.actors[name]?.costUsd ?? null),
                        cost,
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block" aria-labelledby="configuracao">
        <h2 id="configuracao">Configuração de cada agente</h2>
        <ActorConfigs round={first} />
        {test.previous !== undefined && (
          <div className="changes">
            <h3>
              O que mudou desde o{' '}
              <a href={testHref(test.previous.key)}>
                teste {test.previous.number}
              </a>
            </h3>
            {changes.length === 0 && prompts.length === 0 ? (
              <p className="note">Nada além do objetivo.</p>
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
    </main>
  );
}
