/**
 * Every test, newest first: how many rounds and configurations it ran, and
 * its last round. Filtered by agent: a test shows when one of its agents, in
 * any round, matches the role, provider and model chosen, all at once; in
 * the last round's agents, the matching ones are marked.
 */

import { useState, type ReactNode } from 'react';

import type { ActorSnapshot } from '../../../../src/rounds/types';
import { changeSummary } from '../components/Config';
import { Grade } from '../components/Scores';
import { TestsNav } from '../components/TestsNav';
import { recentTests, type Test } from '../data';
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
import { changedFiles, roundTokens, rulesOf } from '../summary';

const ALL = '';

/** Every agent of every round of a test, by role. */
const agentsOf = (test: Test): [string, ActorSnapshot][] =>
  test.rounds.flatMap((round) => Object.entries(round.record.actors));

/** The distinct values over every agent of every test, sorted. */
const options = (
  pick: (role: string, actor: ActorSnapshot) => string,
): string[] =>
  [
    ...new Set(
      recentTests.flatMap((test) =>
        agentsOf(test).map(([role, actor]) => pick(role, actor)),
      ),
    ),
  ].toSorted();

interface AgentFilter {
  readonly role: string;
  readonly provider: string;
  readonly model: string;
}

const isActive = (filter: AgentFilter): boolean =>
  filter.role !== ALL || filter.provider !== ALL || filter.model !== ALL;

/** The agent matches every part of the filter that is set. */
const matches = (
  role: string,
  actor: ActorSnapshot,
  filter: AgentFilter,
): boolean =>
  (filter.role === ALL || role === filter.role) &&
  (filter.provider === ALL || actor.provider.name === filter.provider) &&
  (filter.model === ALL || actor.provider.model === filter.model);

function Filter({
  label,
  value,
  values,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly values: readonly string[];
  readonly onChange: (value: string) => void;
}): ReactNode {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={ALL}>todos</option>
        {values.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function IndexPage(): ReactNode {
  const [role, setRole] = useState(ALL);
  const [provider, setProvider] = useState(ALL);
  const [model, setModel] = useState(ALL);
  const filter: AgentFilter = { role, provider, model };
  const active = isActive(filter);
  const shown = recentTests.filter((test) =>
    agentsOf(test).some(([name, actor]) => matches(name, actor, filter)),
  );
  // The models of the chosen provider only.
  const models = options((_role, actor) =>
    provider === ALL || actor.provider.name === provider
      ? actor.provider.model
      : '',
  ).filter((value) => value !== '');
  const chooseProvider = (value: string): void => {
    setProvider(value);
    const keeps = recentTests.some((test) =>
      agentsOf(test).some(
        ([, actor]) =>
          actor.provider.name === value && actor.provider.model === model,
      ),
    );
    if (value !== ALL && !keeps) setModel(ALL);
  };

  return (
    <main className="page">
      <TestsNav />
      <header>
        <span className="eyebrow">bun run rounds · rounds/data</span>
        <h1>Testes</h1>
        <p>
          Um teste é uma declaração em <code>rounds/definitions</code>. Cada vez
          que ela roda é uma rodada, e cada rodada diz o que mudou desde a
          anterior: modelo, CLI, política, pedidos.
        </p>
      </header>

      <section className="block" aria-labelledby="todos">
        <h2 id="todos">Todos os testes, do mais recente</h2>
        <div className="filters">
          <Filter
            label="Agente"
            value={role}
            values={options((name) => name)}
            onChange={setRole}
          />
          <Filter
            label="Provider"
            value={provider}
            values={options((_name, actor) => actor.provider.name)}
            onChange={chooseProvider}
          />
          <Filter
            label="Modelo"
            value={model}
            values={models}
            onChange={setModel}
          />
        </div>
        <p className="note" aria-live="polite">
          {shown.length === recentTests.length
            ? `Todos os ${String(recentTests.length)} testes`
            : `${String(shown.length)} de ${String(recentTests.length)} testes`}
          {active &&
            shown.length > 0 &&
            ' · os agentes que casam com o filtro estão destacados'}
        </p>
        {shown.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Teste</th>
                  <th scope="col">Rodadas</th>
                  <th scope="col">Agentes na última rodada</th>
                  <th scope="col">Última rodada</th>
                  <th scope="col">Tempo</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Custo</th>
                  <th scope="col">Arquivos</th>
                  <th scope="col">Regras</th>
                  <th scope="col">Nota</th>
                  <th scope="col">Eficácia</th>
                  <th scope="col">Eficiência</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((test) => {
                  const last = test.rounds.at(-1);
                  if (last === undefined) return null;
                  const { record } = last;
                  const changed =
                    last.previous === undefined
                      ? 'primeira rodada'
                      : changeSummary(record, last.previous).join(', ') ||
                        'nada: mesma configuração';
                  return (
                    <tr key={test.key}>
                      <th scope="row">
                        <a href={testHref(test.key)}>
                          <small>
                            {count(
                              test.configurations,
                              'configuração',
                              'configurações',
                            )}
                          </small>
                          {test.title}
                        </a>
                      </th>
                      <td>
                        {test.rounds.map((round) => (
                          <div key={round.record.id}>
                            <a href={roundHref(round.record.id)}>
                              Rodada {round.index}
                            </a>
                          </div>
                        ))}
                      </td>
                      <td>
                        {Object.entries(record.actors).map(([name, actor]) => (
                          <div
                            key={name}
                            className={
                              active
                                ? matches(name, actor, filter)
                                  ? 'agent match'
                                  : 'agent dim'
                                : 'agent'
                            }
                          >
                            {title(name)}:{' '}
                            <span className="muted">{providerOf(actor)}</span>
                          </div>
                        ))}
                      </td>
                      <td>
                        <a href={roundHref(record.id)}>Rodada {last.index}</a>
                        <div className="muted">
                          {when(record.timing.startedAt)}
                        </div>
                        {record.label !== undefined && (
                          <div className="label">“{record.label}”</div>
                        )}
                        <div className="muted">mudou: {changed}</div>
                      </td>
                      <td>{duration(record.timing.durationMs)}</td>
                      <td>{tokensShort(roundTokens(record))}</td>
                      <td>{cost(record.totals.round.costUsd)}</td>
                      <td>{changedFiles(record) ?? '—'}</td>
                      <td>{rulesOf(record)}</td>
                      <td>
                        <Grade score={last.score.round.final} />
                      </td>
                      <td>
                        <Grade score={last.score.round.effectiveness.score} />
                      </td>
                      <td>
                        <Grade score={last.score.round.efficiency.score} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {shown.length === 0 && (
          <p className="note">Nenhum teste com esses filtros.</p>
        )}
      </section>
    </main>
  );
}
