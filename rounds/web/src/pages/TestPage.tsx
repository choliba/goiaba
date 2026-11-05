/**
 * A test: a declaration and every round it ran, in order. Each round says
 * what changed since the one before (model, CLI, policy, prompts…); rounds
 * with the same configuration are averaged together, and only those.
 */

import type { ReactNode } from 'react';

import type { RoundRecord } from '../../../../src/rounds/types';
import { ActorConfigs, changeSummary } from '../components/Config';
import { Grade, grade } from '../components/Scores';
import { TestRounds } from '../components/TestRounds';
import { TestsNav } from '../components/TestsNav';
import type { Round, Test } from '../data';
import {
  cost,
  count,
  duration,
  providerOf,
  title,
  tokensShort,
  when,
  goalOf,
} from '../format';
import { roundHref } from '../route';
import {
  changedFiles,
  decimal,
  ranged,
  roundTokens,
  rulesOf,
} from '../summary';

/** What changed since the round before, for the table. */
function changes(round: Round): string {
  if (round.previous === undefined) return 'primeira rodada';
  const parts = changeSummary(round.record, round.previous);
  return parts.length === 0 ? 'nada: mesma configuração' : parts.join(', ');
}

/** `rodada 3`, `rodadas 3 e 4`, `rodadas 2, 3 e 5`. */
function roundList(rounds: readonly Round[]): string {
  const numbers = rounds.map((round) => String(round.index));
  const last = numbers.pop() ?? '';
  return numbers.length === 0
    ? `rodada ${last}`
    : `rodadas ${numbers.join(', ')} e ${last}`;
}

function Averages({
  rounds,
}: {
  readonly rounds: readonly Round[];
}): ReactNode {
  const records = rounds.map((round) => round.record);
  return (
    <>
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
    </>
  );
}

export function TestPage({ test }: { readonly test: Test }): ReactNode {
  const last = test.rounds.at(-1);
  if (last === undefined) return null;
  const byConfiguration = [
    ...Map.groupBy(test.rounds, (round) => round.configuration).entries(),
  ].filter(([, rounds]) => rounds.length > 1);
  const current = test.rounds.filter(
    (round) => round.configuration === last.configuration,
  );
  const records = current.map((round) => round.record);
  /** One value per round of the current configuration. */
  const of = <T,>(pick: (record: RoundRecord) => T): T[] => records.map(pick);

  return (
    <main className="page">
      <TestsNav current={test.key} />

      <TestRounds test={test} />

      <header>
        <span className="eyebrow">
          {test.key} · {count(test.rounds.length, 'rodada', 'rodadas')} ·{' '}
          {count(test.configurations, 'configuração', 'configurações')}
        </span>
        <h1>{test.title}</h1>
        <p>
          <strong>Objetivo:</strong> {goalOf(test.goal)}
        </p>
        <p className="muted">
          Cada execução é uma rodada, e cada rodada diz o que mudou desde a
          anterior. As médias só juntam rodadas da mesma configuração.
        </p>
      </header>

      <section className="block" aria-labelledby="rodadas">
        <h2 id="rodadas">Rodadas</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Rodada</th>
                <th scope="col">O que mudou desde a anterior</th>
                <th scope="col">Tempo</th>
                <th scope="col">Tokens</th>
                <th scope="col">Custo</th>
                <th scope="col">Arquivos alterados</th>
                <th scope="col">Regras</th>
                <th scope="col">Eficácia</th>
                <th scope="col">Eficiência</th>
              </tr>
            </thead>
            <tbody>
              {test.rounds.map((round) => {
                const changed =
                  round.previous !== undefined &&
                  changeSummary(round.record, round.previous).length > 0;
                return (
                  <tr key={round.record.id}>
                    <th scope="row">
                      <a href={roundHref(round.record.id)}>
                        <small>
                          config. {round.configuration} ·{' '}
                          {when(round.record.timing.startedAt)}
                        </small>
                        Rodada {round.index}
                      </a>
                    </th>
                    <td>
                      {round.record.label !== undefined && (
                        <p className="label">“{round.record.label}”</p>
                      )}
                      <span className={changed ? 'changed' : 'muted'}>
                        {changes(round)}
                      </span>
                    </td>
                    <td>{duration(round.record.timing.durationMs)}</td>
                    <td>{tokensShort(roundTokens(round.record))}</td>
                    <td>{cost(round.record.totals.round.costUsd)}</td>
                    <td>{changedFiles(round.record) ?? 'não conferido'}</td>
                    <td>{rulesOf(round.record)}</td>
                    <td>
                      <Grade score={round.score.round.effectiveness.score} />
                    </td>
                    <td>
                      <Grade score={round.score.round.efficiency.score} />
                    </td>
                  </tr>
                );
              })}
              {byConfiguration.map(([configuration, rounds]) => (
                <tr key={`media-${configuration}`} className="total">
                  <th scope="row">
                    Média da config. <code>{configuration}</code>
                    <small>{roundList(rounds)} · menor – maior</small>
                  </th>
                  <td />
                  <Averages rounds={rounds} />
                  <td />
                  <td>
                    {ranged(
                      rounds.map((r) => r.score.round.effectiveness.score),
                      grade,
                    )}
                  </td>
                  <td>
                    {ranged(
                      rounds.map((r) => r.score.round.efficiency.score),
                      grade,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block" aria-labelledby="agentes">
        <h2 id="agentes">
          Cada agente, na configuração atual ({roundList(current)})
        </h2>
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
              {Object.entries(last.record.actors).map(([name, actor]) => (
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
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block" aria-labelledby="configuracao">
        <h2 id="configuracao">Configuração atual de cada agente</h2>
        <p className="note">
          A da rodada {last.index}. O que mudou em cada rodada está na página
          dela.
        </p>
        <ActorConfigs round={last.record} />
      </section>
    </main>
  );
}
