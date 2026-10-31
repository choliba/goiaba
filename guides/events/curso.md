# Módulo events: para que ele existe

Dentro do Goiaba, uma parte do sistema faz algo (um agente recebe uma entrada, gera uma saída, "pensa", erra) e outras partes precisam saber disso. O módulo `events` liga essas partes **sem que uma conheça a outra**:

- o **produtor** avisa o que aconteceu, com o próprio nome;
- o **consumidor** assina os produtores que lhe interessam e recebe só os eventos deles.

Os dois se encontram pelo **nome do produtor**, e nada mais. Quem faz o pedido não sabe que existe cobrança; quem cobra não sabe quem fez o pedido.

O módulo não faz I/O: nada sai do processo por aqui. Entregar para fora é papel da saída (`src/output`); registrar é papel do logger (`src/logger`).

## Os arquivos

| Arquivo | Papel |
| --- | --- |
| `src/events/index.ts` | O módulo inteiro: os tipos (`GoiabaEvent`, `EventInput`, `Producer`, `Consumer`, `EventListener`), `createProducer`, `createConsumer` e `ALL_SOURCES`. |
| `src/scope/index.ts` | Não é do módulo, mas é usado por ele: `currentScope()` diz qual agente está rodando, e esses dados entram em todo evento. |

## Como funciona

```
fazerPedido() ── loja.emit() ──▶ [ 'loja' ] ──┬─▶ cobranca
                                              └─▶ notaFiscal
                                 [ '*'    ] ────▶ painel (assina todos)
```

1. **Criar um produtor.** `createProducer('loja')` devolve um objeto com `source` (o nome) e `emit`. O nome não pode ser vazio nem `'*'`, que é reservado.
2. **Criar um consumidor.** `createConsumer(funcao)` devolve um objeto com `subscribe`, `unsubscribe`, `unsubscribeAll` e `sources`. Criar não assina nada.
3. **Assinar.** `consumidor.subscribe('loja')`, ou vários de uma vez: `subscribe('loja', 'estoque')`. `ALL_SOURCES` (`'*'`) assina todos os produtores, inclusive os que ainda não existem.
4. **Emitir.** `loja.emit({ type: 'pedido_feito', ...dados })`. O módulo monta o evento:
   - `ts`: data e hora ISO;
   - os dados do `currentScope()`: `agent`, `run` e `agentProvider`, **se** a chamada estiver dentro de `asAgent(...)`;
   - o que foi emitido;
   - `source`: o nome do produtor, **por último**. Um `source` nos dados não troca a origem.
5. **Entregar.** Cada consumidor assinado no nome do produtor, ou em `'*'`, recebe o evento **uma vez**, na hora, de forma síncrona.
6. **Desassinar.** `unsubscribe('loja')` tira de um produtor; `unsubscribeAll()` tira de todos. `sources()` diz o que ele assina agora.

## Exemplos

Os exemplos abaixo rodam: estão em `agents/meus-testes/events.ts` (`bun agents/meus-testes/events.ts`).

### Exemplo genérico 1: pedido e cobrança

Todo pedido feito dispara a cobrança.

```ts
import { createConsumer, createProducer } from '../../src/events/index';

const loja = createProducer('loja');

/** Faz um pedido e avisa que ele foi feito. */
function fazerPedido(cliente: string, valor: number): void {
  // … grava o pedido …
  loja.emit({ type: 'pedido_feito', cliente, valor });
}

/** Cobra um pedido. */
function cobrar(cliente: string, valor: number): void {
  // … cobra …
}

const cobranca = createConsumer((event) => {
  if (event.type !== 'pedido_feito') return;
  cobrar(String(event['cliente']), Number(event['valor']));
});
cobranca.subscribe('loja');

fazerPedido('Ana', 42.5); // → cobrar('Ana', 42.5)
fazerPedido('Bruno', 18); // → cobrar('Bruno', 18)

cobranca.unsubscribeAll();
fazerPedido('Carla', 10); // ninguém assina mais a loja: sem cobrança
```

Para emitir nota fiscal a cada pedido, basta **mais um consumidor** assinando `'loja'`. `fazerPedido` não muda.

O consumidor filtra o `type` (`pedido_feito`), porque um produtor pode emitir vários tipos. E lê os dados como `event['cliente']`: o evento não sabe o formato dos dados de cada produtor, então o consumidor converte (`String`, `Number`).

### Exemplo genérico 2: vários produtores, vários consumidores

```
produtor1 ─┬─▶ consumidor1
           └─▶ consumidor2
produtor2 ─┬─▶ consumidor1   ← o mesmo consumidor ouvindo dois
           └─▶ consumidor3
```

```ts
const produtor1 = createProducer('produtor1');
const produtor2 = createProducer('produtor2');

const consumidor1 = createConsumer(imprimir('consumidor1'));
const consumidor2 = createConsumer(imprimir('consumidor2'));
const consumidor3 = createConsumer(imprimir('consumidor3'));

consumidor1.subscribe('produtor1', 'produtor2');
consumidor2.subscribe('produtor1');
consumidor3.subscribe('produtor2');

produtor1.emit({ type: 'a' }); // consumidor1, consumidor2
produtor2.emit({ type: 'b' }); // consumidor1, consumidor3

consumidor1.unsubscribe('produtor1');
consumidor1.sources(); // ['produtor2']
produtor1.emit({ type: 'c' }); // só consumidor2
```

Saída real:

```
consumidor1 ← produtor1: a
consumidor2 ← produtor1: a
consumidor1 ← produtor2: b
consumidor3 ← produtor2: b
consumidor2 ← produtor1: c
```

### Exemplo genérico 3: um consumidor de tudo

Para um painel de depuração, que quer ver o que todo mundo emite:

```ts
import { ALL_SOURCES, createConsumer } from '../../src/events/index';

const painel = createConsumer((event) => {
  // event.source diz de qual produtor veio
});
painel.subscribe(ALL_SOURCES);
```

Ele recebe de produtores criados depois dele, e recebe cada evento uma vez mesmo se também assinar um nome (`subscribe(ALL_SOURCES, 'loja')`).

### Exemplo com agente 1: o próprio Agent é produtor e consumidor

Em `src/agent/agent.ts`, há **um produtor para todos os agentes**, criado uma vez no módulo:

```ts
/** The producer of every agent's events; each event carries its `agent`. */
const AGENT_SOURCE = 'agent';
const agentEvents = createProducer(AGENT_SOURCE);

/** The conversation: for the subscribers and the log. */
function publish(record: LogInput, level?: 'debug' | 'error'): void {
  agentEvents.emit(record);
  if (level === undefined) log.info(record);
  else log[level](record);
}
```

Emitir e registrar são duas coisas: `publish` faz as duas, mas o `tick` do `thinking` só é emitido (`agentEvents.emit(record)`), porque é um relógio e não algo que aconteceu.

E **um consumidor por conversa**: assina no começo, desassina no `finally`, aconteça o que acontecer:

```ts
// início de converse()
const subscribers = createConsumer((event) => {
  if (event.agent !== this.name) return; // o produtor 'agent' é de todos
  const output = new AgentOutput(event, this);
  for (const subscriber of this.subscribers) subscriber(output);
});
subscribers.subscribe(AGENT_SOURCE);

try {
  // … a conversa inteira …
} finally {
  // …
  subscribers.unsubscribeAll();
}
```

O filtro por `event.agent` continua necessário: o produtor é compartilhado, e cada evento diz de qual agente veio. Sem ele, os `subscribe` de um agente receberiam a conversa de outro.

### Exemplo com agente 2: um produtor seu, durante a execução de um agente

Um produtor qualquer, chamado durante um `Agent.run()`, já leva o agente no evento, sem passar nada. Tudo o que roda durante o `run()` (executor, sandbox, gate, providers) está dentro de `asAgent(...)`:

```ts
import { createConsumer, createProducer } from '../../src/events/index';
import { asAgent } from '../../src/scope/index';

const curso = createProducer('curso');
const detalhe = createConsumer((event) => {
  // event.agent, event.run, event.agentProvider
});
detalhe.subscribe('curso');

curso.emit({ type: 'gravado', path: 'a.md' }); // fora de um agente

asAgent(
  { name: 'instructor', provider: { name: 'ollama', model: 'instructor' } },
  () => curso.emit({ type: 'gravado', path: 'b.md' }), // dentro
);
```

Saída real:

```json
{"ts":"2026-10-31T22:47:55.052Z","type":"gravado","path":"a.md","source":"curso"}
{"ts":"2026-10-31T22:47:55.052Z","agent":"instructor","run":"4eec7755-…","agentProvider":{"name":"ollama","model":"instructor"},"type":"gravado","path":"b.md","source":"curso"}
```

Com isso, um consumidor pode separar os eventos por agente (`event.agent`) ou por execução (`event.run`), mesmo vindo de um produtor que não sabe nada de agentes.

### Exemplo com agente 3: ouvir um agente de fora do pacote

`createProducer` e `createConsumer` não são exportados por `src/index.ts`: só o tipo `GoiabaEvent` é. Quem usa o Goiaba ouve **um agente** pela opção `subscribe`, que recebe um `AgentOutput` (`type()`, `data()`, `ts()`, `agent()`), já filtrado para aquele agente:

```ts
import { Agent, type AgentOutput, OllamaProvider, Workspace } from '../src/index';

const agente = new Agent({
  name: 'assistente',
  prompt: 'vamos conversar',
  provider: new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b' }),
  workspace: new Workspace({ type: 'bubblewrap', root }),
  subscribe: [pensando], // assina
});

await agente.run();

function pensando(output: AgentOutput): void {
  if (output.type() !== 'thinking') return;
  const { phase, seconds } = output.data(); // 'start' | 'tick' | 'end'
}
```

- **Assinar:** só na criação, pela lista `subscribe`.
- **Desassinar:** não há `unsubscribe` no agente. A assinatura vale enquanto o `run()` dura (é o consumidor do Exemplo com agente 1). Para parar de reagir antes, o próprio listener ignora os eventos.

## Regras do módulo

**Só o módulo pode:**

- Guardar quem assina cada produtor. O registro não é exportado: só se entra por `subscribe` e só se sai por `unsubscribe`/`unsubscribeAll`.
- Pôr `source`, `ts` e o escopo do agente em todo evento. O `source` é sempre o do produtor.

**Ninguém deve:**

- **Esquecer de desassinar.** Um consumidor assinado continua recebendo (e segurando o que a função dele referencia) até o processo acabar. Assine e desassine no mesmo lugar, com `try/finally`.
- **Lançar erro num consumidor.** A entrega é síncrona e em sequência, sem `try/catch`: um erro impede os consumidores seguintes e sobe para quem chamou `emit`.
- **Usar evento para gravar log ou entregar para fora.** Quem produz decide se o acontecimento também vai para o log, chamando o logger à parte (como `publish` faz).
- **Criar produtor com nome vazio ou `'*'`.** `createProducer` recusa.

## Exercícios

1. **Simples.** No exemplo de pedido e cobrança, acrescente uma nota fiscal: um segundo consumidor que, a cada `pedido_feito`, gera a nota. Que linha de `fazerPedido` você precisou mudar?

2. **Intermediário.** Um consumidor faz `subscribe(ALL_SOURCES, 'loja')` e a loja emite um pedido. Quantas vezes ele recebe esse evento, e por quê? Depois ele chama `unsubscribe('loja')`: continua recebendo os pedidos da loja?

3. **Difícil.** Dois agentes, `a` e `b`, rodam ao mesmo tempo no mesmo processo, e cada um tem uma função em `subscribe`. Explique, seguindo o código de `converse()`, por que a função de `a` não recebe a conversa de `b`, e o que aconteceria se o filtro `event.agent !== this.name` fosse removido. Em seguida, proponha, sem implementar, como o módulo poderia deixar o próprio consumidor pedir só os eventos de um agente.
