import { expect, test } from 'bun:test';

import { watchThinking } from '../src/agent/agent';

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

test('thinking: começa na hora, avisa enquanto a CLI trabalha e termina quando ela fala', async () => {
  const phases: string[] = [];
  const thinking = watchThinking((phase) => phases.push(phase), { every: 20 });

  expect(phases).toEqual(['start']);
  await wait(50);
  expect(phases.filter((phase) => phase === 'tick').length).toBeGreaterThan(0);

  thinking.spoke();
  expect(phases.at(-1)).toBe('end');
  thinking.stop();
  // Already ended: stop does not end it again.
  expect(phases.filter((phase) => phase === 'end')).toHaveLength(1);
});

test('thinking: volta a começar depois de um tempo calado, e não avança pausado', async () => {
  const phases: string[] = [];
  let paused = false;
  const thinking = watchThinking((phase) => phases.push(phase), {
    every: 20,
    paused: () => paused,
  });

  thinking.spoke();
  await wait(50);
  expect(phases.filter((phase) => phase === 'start')).toHaveLength(2);

  paused = true;
  const before = phases.length;
  await wait(50);
  expect(phases).toHaveLength(before);

  thinking.stop();
  expect(phases.at(-1)).toBe('end');
});
