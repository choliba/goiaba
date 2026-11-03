/** Exemplo 4 do curso de context: enriquecer um evento com o contexto atual. */
import {
  createConsumer,
  createProducer,
  type GoiabaEvent,
} from '../../../src/events/index';
import { writeOut } from '../../../src/output/stdio';
import { runAs } from '../../../src/context/index';

const received: GoiabaEvent[] = [];
const consumer = createConsumer((event) => received.push(event));
consumer.subscribe('importacao');

const imports = createProducer('importacao');

runAs({ name: 'construtor', provider: { name: 'codex', model: 'local' } }, () =>
  imports.emit({ type: 'arquivo_lido', path: 'src/app.ts' }),
);

const event = received.at(0);
if (event !== undefined) {
  writeOut(`${event.source}/${event.type}: ${event.agent}\n`);
  writeOut(
    `provider: ${event.agentProvider?.name}/${event.agentProvider?.model}\n`,
  );
  writeOut(`execução presente: ${event.run !== undefined}\n`);
}

consumer.unsubscribeAll();
