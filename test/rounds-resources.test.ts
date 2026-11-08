import { expect, test } from 'bun:test';

import {
  cpuPercent,
  parseCpuTimes,
  parseCpuinfo,
  parseMemTotalMb,
  parseMemUsedMb,
  summarize,
  summarizeWithin,
} from '../src/rounds/resources';
import type { ResourceSample } from '../src/rounds/types';

test('parseCpuTimes: total e idle da primeira linha cpu de /proc/stat', () => {
  expect(
    parseCpuTimes('cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 50 0 50 400'),
  ).toEqual({ total: 1000, idle: 800 });
});

test('parseCpuTimes: /proc/stat sem linha cpu dá indefinido', () => {
  expect(parseCpuTimes('intr 123 456')).toBeUndefined();
});

test('cpuPercent: parte busy entre duas leituras', () => {
  // delta total 800, delta idle 600 → 25% ocupado.
  expect(
    cpuPercent({ total: 1000, idle: 800 }, { total: 1800, idle: 1400 }),
  ).toBe(25);
});

test('cpuPercent: sem avanço no relógio dá 0, não divide por zero', () => {
  const times = { total: 1000, idle: 800 };
  expect(cpuPercent(times, times)).toBe(0);
});

test('/proc/meminfo: total e usado em MB', () => {
  const meminfo = [
    'MemTotal:       16777216 kB',
    'MemFree:         1000000 kB',
    'MemAvailable:    8388608 kB',
    'Buffers:          200000 kB',
  ].join('\n');
  expect(parseMemTotalMb(meminfo)).toBe(16384);
  // (16777216 - 8388608) / 1024 = 8192 MB.
  expect(parseMemUsedMb(meminfo)).toBe(8192);
});

test('/proc/cpuinfo: modelo e número de processadores', () => {
  const cpuinfo = [
    'processor\t: 0',
    'model name\t: Intel(R) Core(TM) i7-9750H',
    'cpu MHz\t\t: 2600.000',
    '',
    'processor\t: 1',
    'model name\t: Intel(R) Core(TM) i7-9750H',
    '',
  ].join('\n');
  expect(parseCpuinfo(cpuinfo)).toEqual({
    model: 'Intel(R) Core(TM) i7-9750H',
    cores: 2,
  });
});

test('/proc/cpuinfo ilegível: modelo desconhecido, zero núcleos', () => {
  expect(parseCpuinfo('')).toEqual({ model: 'desconhecido', cores: 0 });
});

const sample = (
  ts: string,
  cpuPct: number,
  memUsedMb: number,
  gpu: ResourceSample['gpu'] = null,
): ResourceSample => ({ ts, cpuPct, memUsedMb, gpu });

test('summarize: média, pico e energia (Wh) da GPU', () => {
  const samples = [
    sample('2026-11-08T10:00:00.000Z', 10, 100, {
      utilPct: 50,
      memUsedMb: 1000,
      powerW: 60,
      tempC: 70,
    }),
    sample('2026-11-08T10:00:01.000Z', 30, 200, {
      utilPct: 70,
      memUsedMb: 1200,
      powerW: 80,
      tempC: 72,
    }),
  ];
  const summary = summarize(samples);
  expect(summary.cpu).toEqual({ avgPct: 20, peakPct: 30 });
  expect(summary.mem).toEqual({ avgMb: 150, peakMb: 200 });
  expect(summary.gpu).toEqual({
    avgUtilPct: 60,
    peakUtilPct: 70,
    avgMemMb: 1100,
    peakMemMb: 1200,
    // Trapézio: (60+80)/2 W por 1 s = 70 J = 70/3600 Wh.
    energyWh: 0.02,
  });
});

test('summarize sem amostras com GPU: gpu nulo', () => {
  const summary = summarize([
    sample('2026-11-08T10:00:00.000Z', 5, 100),
    sample('2026-11-08T10:00:01.000Z', 15, 100),
  ]);
  expect(summary.cpu).toEqual({ avgPct: 10, peakPct: 15 });
  expect(summary.gpu).toBeNull();
});

test('summarize de conjunto vazio: zeros e gpu nulo', () => {
  expect(summarize([])).toEqual({
    cpu: { avgPct: 0, peakPct: 0 },
    mem: { avgMb: 0, peakMb: 0 },
    gpu: null,
  });
});

test('summarizeWithin: só as amostras dentro da janela do agente', () => {
  const samples = [
    sample('2026-11-08T10:00:00.000Z', 10, 100),
    sample('2026-11-08T10:00:05.000Z', 30, 300),
    sample('2026-11-08T10:00:10.000Z', 90, 900),
  ];
  // Janela que cobre só a amostra do meio.
  const summary = summarizeWithin(samples, [
    {
      startedAt: '2026-11-08T10:00:03.000Z',
      endedAt: '2026-11-08T10:00:07.000Z',
      durationMs: 4000,
    },
  ]);
  expect(summary.cpu).toEqual({ avgPct: 30, peakPct: 30 });
  expect(summary.mem).toEqual({ avgMb: 300, peakMb: 300 });
});
