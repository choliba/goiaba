/**
 * Every test, newest first: how many rounds each ran and their means (one
 * round alone says little: the same configuration changed 2 files once and
 * 5 the next time). Filtered by declaration and by agent: a test shows when
 * one of its agents matches the role, provider and model chosen, all at once;
 * the matching agents are marked.
 */

import { useState, type ReactNode } from 'react';

import type { ActorSnapshot } from '../../../../src/rounds/types';
import { TestsNav } from '../components/TestsNav';
import { lastRun, recentTests, type Test } from '../data';
import {
  cost,
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
  testRules,
} from '../summary';

const ALL = '';

/** Each agent of a test, by role (the same in every round of a test). */
const agentsOf = (test: Test): [string, ActorSnapshot][] =>
  Object.entries(test.rounds[0]?.record.actors ?? {});

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

const definitionOptions = [
  ...new Set(recentTests.map((test) => test.definition.id)),
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
  const [definition, setDefinition] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [provider, setProvider] = useState(ALL);
  const [model, setModel] = useState(ALL);
  const filter: AgentFilter = { role, provider, model };
  const active = isActive(filter);
  const shown = recentTests.filter(
    (test) =>
      (definition === ALL || test.definition.id === definition) &&
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
  const matching = [
    ...new Set(
      shown.flatMap((test) =>
        agentsOf(test)
          .filter(([name, actor]) => matches(name, actor, filter))
          .map(([name]) => name),
      ),
    ),
  ];

  return (
    <main className="page">
      <TestsNav />
      <header>
        <span className="eyebrow">bun run rounds · rounds/data</span>
        <h1>Testes</h1>
        <p>
          Um teste é uma configuração: os mesmos agentes, com o mesmo objetivo.
          Cada execução dele é uma rodada. Os números de cada teste são a média
          das suas rodadas; entre parênteses, a menor e a maior.
        </p>
      </header>

      <section className="block" aria-labelledby="todos">
        <h2 id="todos">Todos os testes, do mais recente</h2>
        <div className="filters">
          <Filter
            label="Rodada declarada"
            value={definition}
            values={definitionOptions}
            onChange={setDefinition}
          />
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
            ` · agentes que casam com o filtro: ${matching.join(', ')} (destacados)`}
          {active &&
            shown.length === recentTests.length &&
            ' · todos os testes têm um agente assim'}
        </p>
        {shown.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Teste</th>
                  <th scope="col">Rodadas</th>
                  <th scope="col">Agentes</th>
                  <th scope="col">Tempo</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Custo</th>
                  <th scope="col">Arquivos alterados</th>
                  <th scope="col">Regras</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((test) => {
                  const records = test.rounds.map((round) => round.record);
                  const first = records[0];
                  return (
                    <tr key={test.key}>
                      <th scope="row">
                        <a href={testHref(test.key)}>
                          <small>
                            Teste {test.number} · última em{' '}
                            {when(lastRun(test))}
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
                        {first !== undefined &&
                          Object.entries(first.actors).map(([name, actor]) => (
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
