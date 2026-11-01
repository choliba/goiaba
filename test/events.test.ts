import { expect, test } from 'bun:test';

import { runAs } from '../src/context/index';
import {
  ALL_SOURCES,
  createConsumer,
  createProducer,
  type Consumer,
  type GoiabaEvent,
} from '../src/events/index';

/** A consumer that writes down what it got, as `source:type`. */
function recorder(): { readonly got: string[]; readonly consumer: Consumer } {
  const got: string[] = [];
  return {
    got,
    consumer: createConsumer((event) =>
      got.push(`${event.source}:${event.type}`),
    ),
  };
}

test('cada consumidor recebe só os produtores que assinou', () => {
  const produtor1 = createProducer('produtor1');
  const produtor2 = createProducer('produtor2');
  const consumidor1 = recorder();
  const consumidor2 = recorder();
  const consumidor3 = recorder();

  consumidor1.consumer.subscribe('produtor1', 'produtor2'); // escuta dois
  consumidor2.consumer.subscribe('produtor1');
  consumidor3.consumer.subscribe('produtor2');
  produtor1.emit({ type: 'a' });
  produtor2.emit({ type: 'b' });
  for (const { consumer } of [consumidor1, consumidor2, consumidor3]) {
    consumer.unsubscribeAll();
  }

  expect(consumidor1.got).toEqual(['produtor1:a', 'produtor2:b']);
  expect(consumidor2.got).toEqual(['produtor1:a']);
  expect(consumidor3.got).toEqual(['produtor2:b']);
});

test('desassina de um produtor ou de todos', () => {
  const produtor1 = createProducer('produtor1');
  const produtor2 = createProducer('produtor2');
  const { got, consumer } = recorder();

  consumer.subscribe('produtor1', 'produtor2');
  consumer.unsubscribe('produtor1');
  expect(consumer.sources()).toEqual(['produtor2']);
  produtor1.emit({ type: 'a' });
  produtor2.emit({ type: 'b' });

  consumer.unsubscribeAll();
  expect(consumer.sources()).toEqual([]);
  produtor2.emit({ type: 'c' });

  expect(got).toEqual(['produtor2:b']);
});

test('dois consumidores da mesma função não se atrapalham', () => {
  const got: string[] = [];
  const listener = (event: GoiabaEvent): void => {
    got.push(event.type);
  };
  const consumidor1 = createConsumer(listener);
  const consumidor2 = createConsumer(listener);
  const produtor = createProducer('produtor');

  consumidor1.subscribe('produtor');
  consumidor2.subscribe('produtor');
  consumidor1.unsubscribeAll();
  produtor.emit({ type: 'a' });
  consumidor2.unsubscribeAll();

  expect(got).toEqual(['a']);
});

test('ALL_SOURCES recebe de qualquer produtor, uma vez por evento', () => {
  const { got, consumer } = recorder();
  consumer.subscribe(ALL_SOURCES, 'curso');

  createProducer('curso').emit({ type: 'gravado' });
  createProducer('rede').emit({ type: 'negado' });
  consumer.unsubscribeAll();

  expect(got).toEqual(['curso:gravado', 'rede:negado']);
});

test('o evento leva ts, o agente que rodava e a origem do produtor', () => {
  const received: GoiabaEvent[] = [];
  const consumer = createConsumer((event) => received.push(event));
  consumer.subscribe('curso');
  const curso = createProducer('curso');

  runAs({ name: 'construtor', provider: { name: 'p', model: 'm' } }, () =>
    // Um `source` no dado não troca a origem: quem emite é o produtor.
    curso.emit({ type: 'gravado', source: 'outro', path: 'a.md' }),
  );
  consumer.unsubscribeAll();

  expect(received).toEqual([
    {
      source: 'curso',
      type: 'gravado',
      path: 'a.md',
      ts: expect.any(String),
      agent: 'construtor',
      run: expect.any(String),
      agentProvider: { name: 'p', model: 'm' },
    },
  ]);
});

test('recusa produtor sem nome ou com o nome reservado', () => {
  expect(() => createProducer('')).toThrow('Nome de produtor inválido');
  expect(() => createProducer(ALL_SOURCES)).toThrow(
    'Nome de produtor inválido',
  );
});
