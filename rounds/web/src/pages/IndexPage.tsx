/**
 * Every test, newest first, filtered by declaration, provider and model:
 * how many rounds each ran and their means (one round alone says little:
 * the same configuration changed 2 files once and 5 the next time).
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

const actorsOf = (test: Test): ActorSnapshot[] =>
  test.rounds.flatMap((round) => Object.values(round.record.actors));
const definitions = (test: Test): string[] => [test.definition.id];
const providers = (test: Test): string[] =>
  actorsOf(test).map((a) => a.provider.name);
const models = (test: Test): string[] =>
  actorsOf(test).map((a) => a.provider.model);

/** The distinct values of `pick` over every test, sorted. */
const options = (pick: (test: Test) => readonly string[]): string[] =>
  [...new Set(recentTests.flatMap(pick))].toSorted();

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
  const [provider, setProvider] = useState(ALL);
  const [model, setModel] = useState(ALL);
  const shown = recentTests.filter(
    (test) =>
      (definition === ALL || definitions(test).includes(definition)) &&
      (provider === ALL || providers(test).includes(provider)) &&
      (model === ALL || models(test).includes(model)),
  );

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
            values={options(definitions)}
            onChange={setDefinition}
          />
          <Filter
            label="Provider"
            value={provider}
            values={options(providers)}
            onChange={setProvider}
          />
          <Filter
            label="Modelo"
            value={model}
            values={options(models)}
            onChange={setModel}
          />
        </div>
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
                          Teste {test.number} · última em {when(lastRun(test))}
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
                          <div key={name}>
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
        {shown.length === 0 && (
          <p className="note">Nenhum teste com esses filtros.</p>
        )}
      </section>
    </main>
  );
}
