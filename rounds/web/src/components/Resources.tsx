/**
 * What the machine was and how much of it the round used: a card with the
 * machine, a table of average and peak CPU/RAM/GPU by agent and for the whole
 * round, and the use over time. Absent when the round has no `resources` (an
 * old record, or a host that could not be read).
 */

import type { ReactNode } from 'react';

import type {
  ResourceSummary,
  RoundResources,
} from '../../../../src/rounds/types';
import type { Round } from '../data';
import { energy, megabytes, NOT_MEASURED, percent, title } from '../format';
import { SampleChart } from './SampleChart';

function avgPeak(avg: string, peak: string): ReactNode {
  return (
    <>
      {avg} <small>pico {peak}</small>
    </>
  );
}

function Row({
  name,
  summary,
  total,
}: {
  readonly name: string;
  readonly summary: ResourceSummary;
  readonly total: boolean;
}): ReactNode {
  return (
    <tr className={total ? 'total' : undefined}>
      <th scope="row">{total ? 'Rodada' : title(name)}</th>
      <td>
        {avgPeak(percent(summary.cpu.avgPct), percent(summary.cpu.peakPct))}
      </td>
      <td>
        {avgPeak(megabytes(summary.mem.avgMb), megabytes(summary.mem.peakMb))}
      </td>
      <td>
        {summary.gpu === null
          ? NOT_MEASURED
          : avgPeak(
              percent(summary.gpu.avgUtilPct),
              percent(summary.gpu.peakUtilPct),
            )}
      </td>
      <td>
        {summary.gpu === null ? NOT_MEASURED : megabytes(summary.gpu.peakMemMb)}
      </td>
      <td>
        {summary.gpu === null ? NOT_MEASURED : energy(summary.gpu.energyWh)}
      </td>
    </tr>
  );
}

function Machine({
  machine,
}: {
  readonly machine: RoundResources['machine'];
}): ReactNode {
  return (
    <dl className="machine">
      <div>
        <dt>Sistema</dt>
        <dd>{machine.os}</dd>
      </div>
      <div>
        <dt>Bun</dt>
        <dd>{machine.bun}</dd>
      </div>
      <div>
        <dt>CPU</dt>
        <dd>
          {machine.cpu.model} <small>{String(machine.cpu.cores)} núcleos</small>
        </dd>
      </div>
      <div>
        <dt>Memória</dt>
        <dd>{megabytes(machine.memTotalMb)}</dd>
      </div>
      <div>
        <dt>GPU</dt>
        <dd>
          {machine.gpu === null ? (
            'sem GPU NVIDIA'
          ) : (
            <>
              {machine.gpu.name}{' '}
              <small>
                {megabytes(machine.gpu.memTotalMb)} · driver{' '}
                {machine.gpu.driver}
              </small>
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}

export function Resources({ round }: { readonly round: Round }): ReactNode {
  const { resources } = round.record;
  if (resources === undefined) return null;

  return (
    <section className="block" aria-labelledby="recursos">
      <h2 id="recursos">Recursos</h2>
      <Machine machine={resources.machine} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Agente</th>
              <th scope="col">CPU</th>
              <th scope="col">RAM</th>
              <th scope="col">GPU</th>
              <th scope="col">VRAM pico</th>
              <th scope="col">Energia</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(resources.actors).map(([name, summary]) => (
              <Row key={name} name={name} summary={summary} total={false} />
            ))}
            <Row name="round" summary={resources.round} total />
          </tbody>
        </table>
      </div>
      <p className="note">
        Da máquina inteira, não só do modelo, a cada{' '}
        {String(resources.intervalMs / 1000)} s. A energia é a potência da GPU
        somada no tempo.
      </p>
      <SampleChart resources={resources} steps={round.record.steps} />
    </section>
  );
}
