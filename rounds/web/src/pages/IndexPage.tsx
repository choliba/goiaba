/**
 * Every run in one table, filtered by declaration, provider and model, and
 * the configurations that ran more than once, side by side: one run alone
 * says little (the same configuration fixed 2 points once and 4 the next).
 */

import { useState, type ReactNode } from 'react';

import { RoundsNav } from '../components/RoundsNav';
import { rounds, type Round } from '../data';
import {
  cost,
  duration,
  NOT_MEASURED,
  providerOf,
  spread,
  sumTokens,
  title,
  tokensShort,
  when,
} from '../format';
import { href } from '../route';

const ALL = '';

/** The distinct values of `pick` over every round, sorted. */
const options = (pick: (round: Round) => readonly string[]): string[] =>
  [...new Set(rounds.flatMap(pick))].toSorted();

const definitions = (round: Round): string[] => [round.record.definition.id];
const providers = (round: Round): string[] =>
  Object.values(round.record.actors).map((actor) => actor.provider.name);
const models = (round: Round): string[] =>
  Object.values(round.record.actors).map((actor) => actor.provider.model);

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

function rules(round: Round): string {
  const { violations, start } = round.record;
  if (start === null) return 'não conferidas';
  if (violations.length === 0) return 'nenhuma declarada';
  const failed = violations.filter((v) => !v.passed).length;
  return failed === 0
    ? `${String(violations.length)} cumpridas`
    : `${String(failed)} violada(s)`;
}

/** `27 s (22 s – 34 s)`: the mean, and the range when it varies. */
function ranged(
  values: readonly (number | null)[],
  show: (value: number) => string,
): string {
  const s = spread(values);
  if (s === undefined) return NOT_MEASURED;
  return s.min === s.max
    ? show(s.mean)
    : `${show(s.mean)} (${show(s.min)} – ${show(s.max)})`;
}

export function IndexPage(): ReactNode {
  const [definition, setDefinition] = useState(ALL);
  const [provider, setProvider] = useState(ALL);
  const [model, setModel] = useState(ALL);
  const shown = rounds.filter(
    (round) =>
      (definition === ALL || definitions(round).includes(definition)) &&
      (provider === ALL || providers(round).includes(provider)) &&
      (model === ALL || models(round).includes(model)),
  );
  const groups = [
    ...Map.groupBy(shown, (round) => round.record.configHash).values(),
  ].filter((group) => group.length > 1);

  return (
    <main className="page">
      <RoundsNav />
      <header>
        <span className="eyebrow">bun run rounds · rounds/data</span>
        <h1>Rodadas</h1>
        <p>
          Cada execução de uma rodada, com o que cada agente fez, quanto tempo e
          quantos tokens gastou, e o que o git mostrou. Uma configuração nova
          ganha um número novo; as repetições dela ficam com o mesmo número.
        </p>
      </header>

      <section className="block" aria-labelledby="todas">
        <h2 id="todas">Todas as execuções</h2>
        <div className="filters">
          <Filter
            label="Rodada"
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
                <th scope="col">Rodada</th>
                <th scope="col">Data</th>
                <th scope="col">Agentes</th>
                <th scope="col">Tempo</th>
                <th scope="col">Tokens</th>
                <th scope="col">Custo</th>
                <th scope="col">Regras</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((round) => {
                const { record, label } = round;
                return (
                  <tr key={record.id}>
                    <th scope="row">
                      <a href={href(record.id)}>
                        <small>Rodada {label}</small>
                        {record.review?.title ?? record.definition.goal}
                      </a>
                    </th>
                    <td>{when(record.timing.startedAt)}</td>
                    <td>
                      {Object.entries(record.actors).map(([name, actor]) => (
                        <div key={name}>
                          {title(name)}:{' '}
                          <span className="muted">{providerOf(actor)}</span>
                        </div>
                      ))}
                    </td>
                    <td>{duration(record.timing.durationMs)}</td>
                    <td>
                      {tokensShort(sumTokens(record.totals.round.tokens))}
                    </td>
                    <td>{cost(record.totals.round.costUsd)}</td>
                    <td>{rules(round)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && (
          <p className="note">Nenhuma execução com esses filtros.</p>
        )}
      </section>

      {groups.length > 0 && (
        <section className="block" aria-labelledby="repeticoes">
          <h2 id="repeticoes">Configurações que rodaram mais de uma vez</h2>
          <p className="note">Média, e entre parênteses a menor e a maior.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Rodada</th>
                  <th scope="col">Execuções</th>
                  <th scope="col">Tempo</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Arquivos alterados</th>
                  <th scope="col">Custo</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const first = group[0];
                  if (first === undefined) return null;
                  const changed = group.map((round) =>
                    round.record.start === null
                      ? null
                      : Object.values(round.record.measures).reduce(
                          (total, m) => total + m.changedFiles,
                          0,
                        ),
                  );
                  return (
                    <tr key={first.record.configHash}>
                      <th scope="row">
                        <small>Rodada {first.number}</small>
                        {first.record.definition.goal}
                      </th>
                      <td>
                        {group.map((round) => (
                          <div key={round.record.id}>
                            <a href={href(round.record.id)}>{round.label}</a>
                          </div>
                        ))}
                      </td>
                      <td>
                        {ranged(
                          group.map((r) => r.record.timing.durationMs),
                          duration,
                        )}
                      </td>
                      <td>
                        {ranged(
                          group.map((r) =>
                            sumTokens(r.record.totals.round.tokens),
                          ),
                          tokensShort,
                        )}
                      </td>
                      <td>
                        {ranged(changed, (v) =>
                          (Math.round(v * 10) / 10).toLocaleString('pt-BR'),
                        )}
                      </td>
                      <td>
                        {ranged(
                          group.map((r) => r.record.totals.round.costUsd),
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
      )}
    </main>
  );
}
