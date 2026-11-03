import { expect, test } from 'bun:test';

import { APPROVALS_FINISHED, listenInput } from '../src/agent/agent';

/** A terminal that types `lines`, then waits forever. */
function terminal(lines: string[]): {
  listen: () => Promise<string>;
  reads: () => number;
} {
  let reads = 0;
  return {
    listen: () => {
      reads += 1;
      const line = lines.shift();
      return line === undefined
        ? new Promise<string>(() => undefined)
        : Promise.resolve(line);
    },
    reads: () => reads,
  };
}

/** Approvals typed at the terminal finish with approvals; the rest passes. */
const map = (input: string): Promise<string> =>
  Promise.resolve(input === ':approvals' ? APPROVALS_FINISHED : input);

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

test('aprovar durante o turno não encerra a escuta do terminal', async () => {
  const { listen, reads } = terminal([':approvals']);
  const typed = listenInput(listen, undefined, map);
  await settle();

  // Still reading: Ctrl+A works again while the CLI goes on.
  expect(reads()).toBe(2);
  // The end of the turn continues with the approvals.
  expect(await typed?.submitted()).toBe(APPROVALS_FINISHED);
});

test('uma mensagem depois da aprovação é a próxima entrada', async () => {
  const { listen } = terminal([':approvals', 'mude o menu']);
  const typed = listenInput(listen, undefined, map);
  await settle();

  expect(await typed?.submitted()).toBe('mude o menu');
});

test('quem já espera a resposta recebe a aprovação na hora', async () => {
  const { listen } = terminal([]);
  let line: ((value: string) => void) | undefined;
  const typed = listenInput(
    () =>
      line === undefined
        ? new Promise<string>((resolve) => {
            line = resolve;
          })
        : listen(),
    undefined,
    map,
  );

  const answer = typed?.promise;
  line?.(':approvals');

  expect(await answer).toBe(APPROVALS_FINISHED);
});

test('sem nada digitado, o fim do turno não tem entrada', async () => {
  const { listen } = terminal([]);
  const typed = listenInput(listen, undefined, map);
  await settle();

  expect(typed?.submitted()).toBeUndefined();
});

test('Ctrl+A continua funcionando depois de uma mensagem digitada', async () => {
  const opened: string[] = [];
  const { listen, reads } = terminal(['use curl', ':approvals', 'e depois']);
  const typed = listenInput(listen, undefined, (input) => {
    if (input === ':approvals') opened.push(input);
    return map(input);
  });
  await settle();

  expect(opened).toEqual([':approvals']);
  // Still reading after all of it.
  expect(reads()).toBe(4);
  // The messages go together, in order, as the next input.
  expect(await typed?.submitted()).toBe('use curl\n\ne depois');
});

test('a entrada que acaba antes de alguém esperar recusa quem esperar depois', async () => {
  const ended = new DOMException('stdin foi fechado.', 'AbortError');
  const typed = listenInput(() => Promise.reject(ended), undefined);
  await settle();

  let error: unknown;
  try {
    await typed?.promise;
  } catch (caught) {
    error = caught;
  }
  expect(error).toBe(ended);
});
