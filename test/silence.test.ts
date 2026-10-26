import { expect, test } from 'bun:test';

import { watchSilence } from '../src/agent/agent';

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

test('avisa uma vez depois do silêncio', async () => {
  let told = 0;
  const silence = watchSilence(() => (told += 1), { ms: 40, every: 10 });

  await wait(120);
  silence.stop();

  expect(told).toBe(1);
});

test('algo mostrado recomeça a contagem e permite novo aviso', async () => {
  let told = 0;
  const silence = watchSilence(() => (told += 1), { ms: 40, every: 10 });

  await wait(25);
  silence.touch();
  await wait(25);
  // 50ms since start, but only 25ms since the last output: no notice yet.
  expect(told).toBe(0);

  await wait(60);
  expect(told).toBe(1);

  silence.touch();
  await wait(70);
  silence.stop();
  expect(told).toBe(2);
});

test('parado, não avisa mais', async () => {
  let told = 0;
  const silence = watchSilence(() => (told += 1), { ms: 20, every: 10 });
  silence.stop();

  await wait(60);

  expect(told).toBe(0);
});
