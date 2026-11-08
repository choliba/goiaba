/**
 * How much of the machine a round uses, sampled over time. Of the round, not
 * of any provider: it reads the host (CPU/GPU/RAM) and knows nothing about
 * which model ran. Composes the owners of each capability — the disk through
 * src/filesystem (/proc), the GPU tool through src/execute (`nvidia-smi`) —
 * and imports no `node:*` of its own.
 */

import { runProgram } from '../execute/process';
import { readText } from '../filesystem/index';
import { log } from '../logger/index';
import { NVIDIA_SMI_TIMEOUT_MS, RESOURCE_SAMPLE_MS } from './constants';
import type {
  MachineSnapshot,
  ResourceSample,
  ResourceSummary,
  Span,
} from './types';

/** A running sampler: the machine read at the start, and the samples so far. */
export interface ResourceSampler {
  readonly machine: MachineSnapshot;
  /** Stops sampling, waits for a sample in flight, and returns them all. */
  stop(): Promise<ResourceSample[]>;
}

/**
 * Reads the machine and starts sampling its use every `intervalMs`. Never
 * throws: a host it cannot read gives a snapshot with what it found and
 * samples with zeros, so a round is still recorded.
 */
export async function beginResources({
  intervalMs = RESOURCE_SAMPLE_MS,
}: { readonly intervalMs?: number } = {}): Promise<ResourceSampler> {
  const machine = await machineSnapshot();
  const hasGpu = machine.gpu !== null;
  const samples: ResourceSample[] = [];

  let prev = readCpuTimes();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    const cur = readCpuTimes();
    const cpuPct =
      prev !== undefined && cur !== undefined ? cpuPercent(prev, cur) : 0;
    if (cur !== undefined) prev = cur;
    samples.push({
      ts: new Date().toISOString(),
      cpuPct,
      memUsedMb: readMemUsedMb(),
      gpu: hasGpu ? await readGpuSample() : null,
    });
  };

  const schedule = (): void => {
    timer = setTimeout(() => {
      // Each tick runs to the end before the next is scheduled: nvidia-smi is
      // async and two must not overlap.
      inFlight = tick().then(() => {
        if (!stopped) schedule();
      });
    }, intervalMs);
  };
  schedule();

  return {
    machine,
    async stop(): Promise<ResourceSample[]> {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await inFlight;
      return samples;
    },
  };
}

/** Average and peak over `samples`; `gpu` null when none had a GPU reading. */
export function summarize(samples: readonly ResourceSample[]): ResourceSummary {
  const cpu = samples.map((s) => s.cpuPct);
  const mem = samples.map((s) => s.memUsedMb);
  const gpu = samples.flatMap((s) => (s.gpu === null ? [] : [{ s, g: s.gpu }]));
  return {
    cpu: { avgPct: avg(cpu), peakPct: peak(cpu) },
    mem: { avgMb: avg(mem), peakMb: peak(mem) },
    gpu:
      gpu.length === 0
        ? null
        : {
            avgUtilPct: avg(gpu.map(({ g }) => g.utilPct)),
            peakUtilPct: peak(gpu.map(({ g }) => g.utilPct)),
            avgMemMb: avg(gpu.map(({ g }) => g.memUsedMb)),
            peakMemMb: peak(gpu.map(({ g }) => g.memUsedMb)),
            energyWh: energyWh(
              gpu.map(({ s, g }) => ({ ts: s.ts, w: g.powerW })),
            ),
          },
  };
}

/** Summary over the samples that fall inside any of `spans` (an agent's steps). */
export function summarizeWithin(
  samples: readonly ResourceSample[],
  spans: readonly Span[],
): ResourceSummary {
  const within = samples.filter((sample) => {
    const t = Date.parse(sample.ts);
    return spans.some(
      (span) =>
        t >= Date.parse(span.startedAt) && t <= Date.parse(span.endedAt),
    );
  });
  return summarize(within);
}

// --- the machine, once ---

async function machineSnapshot(): Promise<MachineSnapshot> {
  const cpuinfo = parseCpuinfo(tryRead('/proc/cpuinfo'));
  return {
    os: osName(),
    bun: Bun.version,
    cpu: cpuinfo,
    memTotalMb: parseMemTotalMb(tryRead('/proc/meminfo')),
    gpu: await gpuInfo(),
  };
}

function osName(): string {
  const type = tryRead('/proc/sys/kernel/ostype').trim();
  const release = tryRead('/proc/sys/kernel/osrelease').trim();
  return [type, release].filter((part) => part.length > 0).join(' ');
}

async function gpuInfo(): Promise<MachineSnapshot['gpu']> {
  const line = (
    await nvidiaSmi(['--query-gpu=name,memory.total,driver_version'])
  )?.trim();
  if (line === undefined || line.length === 0) return null;
  const [name, memTotal, driver] = line.split(',').map((part) => part.trim());
  return {
    name: name === '' ? 'GPU' : name,
    memTotalMb: num(memTotal) ?? 0,
    driver,
  };
}

// --- a sample ---

function readGpuSample(): Promise<ResourceSample['gpu']> {
  return nvidiaSmi([
    '--query-gpu=utilization.gpu,memory.used,power.draw,temperature.gpu',
  ]).then((out) => {
    const line = out?.trim();
    if (line === undefined || line.length === 0) return null;
    const [util, mem, power, temp] = line.split(',').map((part) => part.trim());
    return {
      utilPct: num(util) ?? 0,
      memUsedMb: num(mem) ?? 0,
      powerW: num(power),
      tempC: num(temp),
    };
  });
}

/** `nvidia-smi` for a CSV query, headerless and unit-free; `undefined` on any failure. */
async function nvidiaSmi(
  query: readonly string[],
): Promise<string | undefined> {
  try {
    return await runProgram(
      'nvidia-smi',
      [...query, '--format=csv,noheader,nounits'],
      { timeoutMs: NVIDIA_SMI_TIMEOUT_MS },
    );
  } catch (error) {
    log.debug({ type: 'nvidia-smi-failed', error });
    return undefined;
  }
}

// --- /proc parsing (exported for the tests) ---

/** The jiffies of the first `cpu` line of /proc/stat: total and idle. */
export interface CpuTimes {
  readonly total: number;
  readonly idle: number;
}

export function parseCpuTimes(stat: string): CpuTimes | undefined {
  const line = stat.split('\n').find((row) => row.startsWith('cpu '));
  if (line === undefined) return undefined;
  const fields = line.trim().split(/\s+/).slice(1).map(Number);
  if (fields.length < 5 || fields.some((n) => Number.isNaN(n)))
    return undefined;
  const total = fields.reduce((sum, n) => sum + n, 0);
  // idle + iowait: the time the CPU did nothing.
  const idle = (fields[3] ?? 0) + (fields[4] ?? 0);
  return { total, idle };
}

/** Busy share between two /proc/stat readings, 0–100. */
export function cpuPercent(prev: CpuTimes, cur: CpuTimes): number {
  const total = cur.total - prev.total;
  const idle = cur.idle - prev.idle;
  if (total <= 0) return 0;
  return clampPct(((total - idle) / total) * 100);
}

/** Used memory in MB from /proc/meminfo: total minus available. */
export function parseMemUsedMb(meminfo: string): number {
  const total = meminfoKb(meminfo, 'MemTotal');
  const available = meminfoKb(meminfo, 'MemAvailable');
  if (total === undefined || available === undefined) return 0;
  return Math.round((total - available) / 1024);
}

export function parseMemTotalMb(meminfo: string): number {
  const total = meminfoKb(meminfo, 'MemTotal');
  return total === undefined ? 0 : Math.round(total / 1024);
}

export function parseCpuinfo(cpuinfo: string): MachineSnapshot['cpu'] {
  const lines = cpuinfo.split('\n');
  const cores = lines.filter((line) => line.startsWith('processor')).length;
  const model = lines
    .find((line) => line.startsWith('model name'))
    ?.split(':')[1]
    ?.trim();
  return { model: model ?? 'desconhecido', cores };
}

// --- helpers ---

function readCpuTimes(): CpuTimes | undefined {
  return parseCpuTimes(tryRead('/proc/stat'));
}

function readMemUsedMb(): number {
  return parseMemUsedMb(tryRead('/proc/meminfo'));
}

function meminfoKb(meminfo: string, key: string): number | undefined {
  const line = meminfo.split('\n').find((row) => row.startsWith(`${key}:`));
  if (line === undefined) return undefined;
  return num(line.replace(`${key}:`, '').replace('kB', '').trim()) ?? undefined;
}

function tryRead(path: string): string {
  try {
    return readText(path);
  } catch {
    return '';
  }
}

/** A number from text, or `null` when it is not one (`[N/A]`, empty). */
function num(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function avg(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return round2(values.reduce((sum, n) => sum + n, 0) / values.length);
}

function peak(values: readonly number[]): number {
  return values.length === 0 ? 0 : round2(Math.max(...values));
}

/** Power samples integrated over time, in Wh; `null` when none report power. */
function energyWh(
  points: readonly { readonly ts: string; readonly w: number | null }[],
): number | null {
  const withPower = points.filter((p) => p.w !== null);
  if (withPower.length < 2) return null;
  let joules = 0;
  for (let i = 1; i < withPower.length; i++) {
    const prev = withPower[i - 1];
    const cur = withPower[i];
    const dtSec = (Date.parse(cur.ts) - Date.parse(prev.ts)) / 1000;
    // Trapezoid: the average power of the two ends over the gap between them.
    joules += (((prev.w ?? 0) + (cur.w ?? 0)) / 2) * dtSec;
  }
  return round2(joules / 3600);
}

function clampPct(value: number): number {
  return round2(Math.min(100, Math.max(0, value)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
