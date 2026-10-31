import { expect, test } from 'bun:test';

import { asAgent } from '../src/agent/scope';
import { emit, onEvent, type GoiabaEvent } from '../src/events/index';

test('emit chega a quem ouve, com ts e o agente que estava rodando', () => {
  const received: GoiabaEvent[] = [];
  const stop = onEvent((event) => received.push(event));

  asAgent({ name: 'construtor', provider: { name: 'p', model: 'm' } }, () =>
    emit({ source: 'agent', type: 'input', value: 'olá' }),
  );
  stop();
  emit({ source: 'agent', type: 'input', value: 'ninguém ouve' });

  expect(received).toEqual([
    {
      source: 'agent',
      type: 'input',
      value: 'olá',
      ts: expect.any(String),
      agent: 'construtor',
      run: expect.any(String),
      agentProvider: { name: 'p', model: 'm' },
    },
  ]);
});
