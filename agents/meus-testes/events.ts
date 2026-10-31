/**
 * Exemplos do módulo de eventos: produtor e consumidor.
 *
 *   bun agents/meus-testes/events.ts
 *
 * - Produtor: `createProducer('nome')` e `produtor.emit({ type, ...dados })`.
 * - Consumidor: `createConsumer(funcao)`, que assina produtores com
 *   `subscribe('nome', …)` e desassina com `unsubscribe('nome')` ou
 *   `unsubscribeAll()`.
 *
 * Os dois não se conhecem: se encontram pelo nome do produtor.
 */

import {
  ALL_SOURCES,
  createConsumer,
  createProducer,
  type GoiabaEvent,
} from '../../src/events/index';
import { writeOut } from '../../src/output/terminal';
import { asAgent } from '../../src/scope/index';

function mostrar(texto: string): void {
  writeOut(`${texto}\n`);
}

/** A função de um consumidor que mostra o que recebeu, com o próprio nome. */
function imprimir(consumidor: string) {
  return (event: GoiabaEvent): void => {
    mostrar(`  ${consumidor} ← ${event.source}: ${event.type}`);
  };
}

// ---------------------------------------------------------------------------
// 1. O básico: um produtor, um consumidor
// ---------------------------------------------------------------------------
mostrar('\n1. Um produtor, um consumidor');

const pedidos = createProducer('pedidos');
const cozinha = createConsumer(imprimir('cozinha'));

cozinha.subscribe('pedidos'); // assina
pedidos.emit({ type: 'criado', id: 1, prato: 'feijoada' });
cozinha.unsubscribeAll(); // desassina
pedidos.emit({ type: 'criado', id: 2 }); // ninguém ouve: não aparece

// ---------------------------------------------------------------------------
// 2. O desenho: dois produtores, três consumidores, um deles ouvindo os dois
//
//   produtor1 ─┬─▶ consumidor1
//              └─▶ consumidor2
//   produtor2 ─┬─▶ consumidor1
//              └─▶ consumidor3
// ---------------------------------------------------------------------------
mostrar('\n2. Dois produtores, três consumidores');

const produtor1 = createProducer('produtor1');
const produtor2 = createProducer('produtor2');

const consumidor1 = createConsumer(imprimir('consumidor1'));
const consumidor2 = createConsumer(imprimir('consumidor2'));
const consumidor3 = createConsumer(imprimir('consumidor3'));

consumidor1.subscribe('produtor1', 'produtor2'); // escuta dois
consumidor2.subscribe('produtor1');
consumidor3.subscribe('produtor2');

produtor1.emit({ type: 'a' }); // consumidor1 e consumidor2
produtor2.emit({ type: 'b' }); // consumidor1 e consumidor3

// ---------------------------------------------------------------------------
// 3. Desassinar de um produtor só, e depois de todos
// ---------------------------------------------------------------------------
mostrar('\n3. Desassinar');

consumidor1.unsubscribe('produtor1');
mostrar(`  consumidor1 assina: ${consumidor1.sources().join(', ')}`);
produtor1.emit({ type: 'c' }); // só consumidor2
produtor2.emit({ type: 'd' }); // consumidor1 e consumidor3

for (const consumidor of [consumidor1, consumidor2, consumidor3]) {
  consumidor.unsubscribeAll();
}
produtor1.emit({ type: 'e' }); // ninguém ouve
mostrar('  (depois de unsubscribeAll, ninguém recebe "e")');

// ---------------------------------------------------------------------------
// 4. Um consumidor de tudo (ALL_SOURCES), por exemplo um painel de depuração
// ---------------------------------------------------------------------------
mostrar('\n4. Consumidor de todos os produtores');

const painel = createConsumer(imprimir('painel'));
painel.subscribe(ALL_SOURCES);

createProducer('curso').emit({ type: 'gravado', path: 'guides/x/curso.md' });
createProducer('rede').emit({ type: 'negado', host: 'exemplo.com:443' });

painel.unsubscribeAll();

// ---------------------------------------------------------------------------
// 5. O que vem junto no evento: ts e, dentro de um agente, quem rodava
// ---------------------------------------------------------------------------
mostrar('\n5. O evento completo, dentro e fora de um agente');

const curso = createProducer('curso');
const detalhe = createConsumer((event) => {
  mostrar(`  ${JSON.stringify(event)}`);
});
detalhe.subscribe('curso');

// Fora de um agente: só ts, source, type e os dados.
curso.emit({ type: 'gravado', path: 'a.md' });

// Dentro de um agente (tudo o que roda durante um Agent.run() está assim):
// agent, run e agentProvider entram sozinhos.
asAgent(
  { name: 'instructor', provider: { name: 'ollama', model: 'instructor' } },
  () => curso.emit({ type: 'gravado', path: 'b.md' }),
);

// O produtor manda na origem: um `source` nos dados é ignorado.
curso.emit({ type: 'gravado', source: 'outro', path: 'c.md' });

detalhe.unsubscribeAll();

// ---------------------------------------------------------------------------
// 6. Sempre desassinar, mesmo se der erro no meio (try/finally)
// ---------------------------------------------------------------------------
mostrar('\n6. Assinar só durante uma tarefa');

function tarefaComEventos(): void {
  const observador = createConsumer(imprimir('observador'));
  observador.subscribe('pedidos');
  try {
    pedidos.emit({ type: 'criado', id: 3 });
    pedidos.emit({ type: 'pronto', id: 3 });
  } finally {
    // É o que o Agent faz: assina no começo da conversa, desassina no fim.
    observador.unsubscribeAll();
  }
}

tarefaComEventos();
pedidos.emit({ type: 'criado', id: 4 }); // fora da tarefa: ninguém ouve

// ---------------------------------------------------------------------------
// 7. Pedido e cobrança: todo pedido feito dispara a cobrança
//
// `fazerPedido` não sabe que existe cobrança; `cobrar` não sabe quem fez o
// pedido. Os dois só conhecem o nome do produtor: 'loja'.
// ---------------------------------------------------------------------------
mostrar('\n7. Pedido e cobrança');

const loja = createProducer('loja');

/** Faz um pedido e avisa que ele foi feito. */
function fazerPedido(cliente: string, valor: number): void {
  mostrar(`  pedido de ${cliente}: R$ ${valor.toFixed(2)}`);
  loja.emit({ type: 'pedido_feito', cliente, valor });
}

/** Cobra um pedido. */
function cobrar(cliente: string, valor: number): void {
  mostrar(`  cobrança de ${cliente}: R$ ${valor.toFixed(2)}`);
}

const cobranca = createConsumer((event) => {
  if (event.type !== 'pedido_feito') return;
  cobrar(String(event['cliente']), Number(event['valor']));
});
cobranca.subscribe('loja');

fazerPedido('Ana', 42.5); // → cobrança de Ana
fazerPedido('Bruno', 18); // → cobrança de Bruno

cobranca.unsubscribeAll();
fazerPedido('Carla', 10); // sem cobrança: ninguém assina mais a loja
mostrar('');
