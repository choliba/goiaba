<a id="topo"></a>

# Módulo network: para que ele existe

Um agente roda dentro de uma sandbox, e a CLI dele (Claude, Codex) precisa falar com a internet: o modelo, um `npm install`, uma busca. O módulo `network` decide **para onde ela pode ir**, uma conexão de cada vez, pela política do agente.

A ideia é simples: **a sandbox fica sem rede nenhuma**. A única saída é um proxy do Goiaba, e o proxy pergunta ao **gate de rede** antes de deixar cada conexão passar. O que não passa pelo proxy não tem para onde ir.

```
          sandbox (sem rede própria)                         host
┌───────────────────────────────────────────┐
│  CLI  ── HTTPS_PROXY=127.0.0.1:3128 ──▶ bridge ══ socket unix ══▶ NetworkProxy ──▶ internet
│                                           │                         │
│  127.0.0.1:11434 (Ollama) ─────────▶ bridge (--forward)             ▼
│                                           │                     NetworkGate
│  dev server :5173 ◀── bridge (--publish) ◀══ socket ══ 127.0.0.1:5173 (PublishedPorts)
└───────────────────────────────────────────┘
```

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
  - [Classes](#classes)
  - [Opções do gate e da fronteira (`NetworkGateOptions`)](#opções-do-gate-e-da-fronteira-networkgateoptions)
  - [Regras (`rules.ts`)](#regras-rulests)
  - [Tipos](#tipos)
  - [Constantes e utilitários](#constantes-e-utilitários)
  - [Quem está do outro lado](#quem-está-do-outro-lado)
- [Como funciona](#como-funciona)
  - [Como as regras chegam ao módulo](#como-as-regras-chegam-ao-módulo)
  - [Quando o módulo entra em ação](#quando-o-módulo-entra-em-ação)
  - [O caminho de uma conexão](#o-caminho-de-uma-conexão)
  - [Padrões de host](#padrões-de-host)
  - [localhost tem dois sentidos](#localhost-tem-dois-sentidos)
  - [bubblewrap e docker](#bubblewrap-e-docker)
- [Exemplos](#exemplos)
  - [1. Uma sandbox com a rede passando pelo gate (bubblewrap e docker)](#1-uma-sandbox-com-a-rede-passando-pelo-gate-bubblewrap-e-docker)
  - [2. Ouvir as decisões](#2-ouvir-as-decisões)
  - [3. Num agente: só a política](#3-num-agente-só-a-política)
  - [4. Uma política de rede completa](#4-uma-política-de-rede-completa)
  - [5. O gate sozinho](#5-o-gate-sozinho)
  - [6. Quem aprova](#6-quem-aprova)
  - [7. O que a CLI vê quando é negada](#7-o-que-a-cli-vê-quando-é-negada)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo          | Onde roda             | Papel                                                                                                                                                                                                                                                                                                        |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rules.ts`       | —                     | **As regras de rede e o que elas significam**: o formato (`NetworkRule`, `NetworkRules`), como sai da política (`networkRulesOf`), quem vence (`decideByRules`), o que um padrão cobre (`hostMatches`), o que é inválido (`validateNetworkRules`) e quais viram túnel ao host (`localPorts`).                |
| `types.ts`       | —                     | O contrato: `NetworkRequest` (host, porta, protocolo), `NetworkDecision`, o `NetworkApprover`, os dados do evento de decisão (`NetworkDecisionData`) e o **`NetworkLedger`**, a porta por onde o gate consulta aprovações, lembra as novas e registra decisões (com o banco: `src/store/network-ledger.ts`). |
| `gate.ts`        | host                  | `NetworkGate`: **só decide** cada destino (`host:porta`): `alwaysAllow`/`alwaysDeny`, as regras, as aprovações do _ledger_, e por último quem aprova. Não sabe de store, workspace nem agente: guarda e consulta pelo `NetworkLedger`, avisa pelo produtor `network`.                                        |
| `proxy.ts`       | host                  | `NetworkProxy`: um proxy HTTP num **socket unix**. Pedidos comuns e túneis `CONNECT` (HTTPS); pergunta ao gate e responde `403` com o motivo, ou repassa.                                                                                                                                                    |
| `bridge-main.ts` | **dentro da sandbox** | O que escuta no loopback da sandbox: o proxy em `127.0.0.1:3128`, os `--forward` (endereços locais do host, como o Ollama) e os `--publish` (portas da sandbox abertas para o host). Vai empacotado para o diretório da fronteira: a sandbox o roda sem ver o código do Goiaba.                              |
| `publish.ts`     | host                  | `PublishedPorts`: o caminho de entrada. Abre no `127.0.0.1` do host as portas do workspace (`ports`) e as liga à sandbox pelo bridge.                                                                                                                                                                        |
| `index.ts`       | host                  | `NetworkBoundary`: junta tudo. Cria gate e proxy, monta os argumentos do bridge, dá as variáveis de ambiente (`HTTP_PROXY`…) e liga/desliga.                                                                                                                                                                 |

[↑ topo](#topo)

## Interface

O que `src/network/index.ts` exporta. Tudo o mais (o bridge, as portas publicadas por dentro) é detalhe do módulo.

### Classes

| Classe            | Para que                                          | Principais membros                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NetworkBoundary` | a fronteira inteira: gate, proxy, bridge e portas | `new NetworkBoundary(options: NetworkGateOptions)`<br>`publish(ports)`: as portas do workspace<br>`environment()`: `HTTP_PROXY`… para a sandbox<br>`attach(enter)`: sobe o bridge numa jaula (bubblewrap)<br>`launcher()`: argv que abre a saída e roda um comando (docker)<br>`sandboxDir()`: o diretório da fronteira (socket do proxy, ponte, portas), o único do cache que a sandbox monta<br>`close()` |
| `NetworkGate`     | só decide um destino                              | `new NetworkGate(options: NetworkGateOptions)`<br>`decide(request: NetworkRequest): Promise<NetworkDecision>`                                                                                                                                                                                                                                                                                               |
| `NetworkProxy`    | o proxy HTTP no socket unix                       | `new NetworkProxy(gate)`, `start(socketPath)`, `close()`                                                                                                                                                                                                                                                                                                                                                    |

### Opções do gate e da fronteira (`NetworkGateOptions`)

| Opção         | Tipo              | Obrigatória | O que é                                                   |
| ------------- | ----------------- | ----------- | --------------------------------------------------------- |
| `rules`       | `NetworkRules`    | sim         | só as regras de rede                                      |
| `approve`     | `NetworkApprover` | sim         | quem responde o que as regras deixam em aberto            |
| `ledger`      | `NetworkLedger`   | não         | onde ficam aprovações e decisões; sem ele, nada é gravado |
| `alwaysAllow` | `string[]`        | não         | `host:porta` sempre liberados                             |
| `alwaysDeny`  | `string[]`        | não         | `host:porta` sempre negados                               |

### Regras (`rules.ts`)

| Função                              | Recebe                              | Devolve                                             |
| ----------------------------------- | ----------------------------------- | --------------------------------------------------- |
| `networkRulesOf(policy)`            | a política (qualquer `AgentPolicy`) | `NetworkRules`: as listas `network` e o `default`   |
| `decideByRules(rules, destination)` | regras e `host:porta`               | `NetworkRuleDecision`: `{ policy, source, reason }` |
| `hostMatches(destination, pattern)` | `host:porta` e um padrão            | `boolean`                                           |
| `validateNetworkRules(rules)`       | regras                              | nada; lança `UsageError` se algo não faz sentido    |
| `localPorts(rules)`                 | regras                              | os `localhost:<porta>` que viram túnel ao host      |

### Tipos

| Tipo                  | Forma                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `NetworkRule`         | `{ operations: ('connect' \| '*')[], hosts: string[], ignores?: { hosts?: string[] } }`                |
| `NetworkRules`        | `{ default: 'allow' \| 'deny' \| 'require_approval', allow?, requireApproval?, deny?: NetworkRule[] }` |
| `NetworkRequest`      | `{ hostname, port, protocol: 'http' \| 'https' }`                                                      |
| `NetworkDecision`     | `{ decision: 'allow' \| 'deny', reason }`: o que o proxy usa                                           |
| `NetworkApprover`     | `(request: NetworkApprovalRequest) => Promise<'once' \| 'session' \| 'workspace' \| 'deny'>`           |
| `NetworkLedger`       | `approval(destination)`, `remember(destination, scope)`, `record(entry): number \| undefined`          |
| `NetworkDecisionData` | os dados do evento `decision`: destino, `decision`, `reason`, `decidedBy`                              |

### Constantes e utilitários

| Nome                   | O que é                                                   |
| ---------------------- | --------------------------------------------------------- |
| `NETWORK_SOURCE`       | `'network'`: o nome do produtor, para assinar as decisões |
| `PROXY_PORT`           | `3128`: onde a CLI encontra o proxy, dentro da sandbox    |
| `validatePorts(ports)` | recusa porta fora de 1 a 65535                            |

### Quem está do outro lado

| Onde                          | O quê                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/workspace/index.ts`      | `applyPermissions(permissions, network?: WorkspaceNetworkOptions)`: monta a fronteira com `networkRulesOf` |
| `src/store/network-ledger.ts` | `networkLedger(store, { root, provider })`: o `NetworkLedger` com o banco, mais `setSession(id)`           |
| `src/agent/agent.ts`          | `networkOptions(…)`: o approver, o ledger e os endereços do provider; não importa o `network`              |

[↑ topo](#topo)

## Como funciona

### Como as regras chegam ao módulo

O `network` **não recebe a política inteira**: recebe só as regras dele, num formato próprio, o `NetworkRules`.

Você escreve a política como sempre, com a rede dentro de cada grupo:

```ts
permissions: {
  default: 'deny',
  allow: {
    filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
    network: [{ operations: ['connect'], hosts: ['github.com'] }],
  },
  deny: {
    network: [{ operations: ['*'], hosts: ['169.254.169.254'] }],
  },
}
```

`networkRulesOf` (em `rules.ts`) tira de cada grupo só a lista `network` e leva o `default` junto. Nada mais da política passa:

```ts
networkRulesOf(permissions);
// {
//   default: 'deny',
//   allow: [{ operations: ['connect'], hosts: ['github.com'] }],
//   requireApproval: [],
//   deny: [{ operations: ['*'], hosts: ['169.254.169.254'] }],
// }
```

É isso que o gate e a fronteira recebem, na opção `rules`. Quem faz a transformação é o **workspace**, ao aplicar a política (`src/workspace/index.ts`):

```ts
public applyPermissions(permissions: AgentPolicy, network?: WorkspaceNetworkOptions): void {
  this.sandbox.configureFilesystem(compileFilesystemAccess(permissions, this.root));
  if (network === undefined) return;

  this.configureNetwork(
    new NetworkBoundary({ rules: networkRulesOf(permissions), ...network }),
  );
}
```

O `network` recebe as regras da política e, de quem a aplica, só o que não está nela (`WorkspaceNetworkOptions`):

| Opção         | O que é                                        | Quem dá, num agente                            |
| ------------- | ---------------------------------------------- | ---------------------------------------------- |
| `approve`     | quem responde o que as regras deixam em aberto | o approver do agente (o mesmo dos comandos)    |
| `ledger`      | onde ficam aprovações e decisões               | `networkLedger(store, { root, provider })`     |
| `alwaysAllow` | destinos sempre liberados                      | `provider.networkEndpoints()`: a API do modelo |
| `alwaysDeny`  | destinos sempre negados                        | `provider.networkBlocked()`: a nuvem da CLI    |

A partir daí, o `network` decide sozinho (`decideByRules`), sem perguntar à policy: `deny` vence `requireApproval`, que vence `allow`; o que nenhuma regra cobre fica com o `default`.

### Quando o módulo entra em ação

Para **todo agente com política** (`permissions`), o agente chama `workspace.applyPermissions(permissions, networkOptions(…))`, e o workspace monta a fronteira. Com política, a rede segue a política inteira: as regras de `network`, se houver, e o `default` para o que nenhuma regra cobre. Uma política sem regra de rede e com `default: 'deny'` fecha a rede (menos os endereços do provider).

Sem política nenhuma, não há `NetworkBoundary`: a sandbox usa a rede do host (`--share-net` no bubblewrap). É o mesmo de todo o resto sem política: só a sandbox limita.

O workspace entrega a fronteira à sandbox (`isolateNetwork`), que fica sem rede própria. Um workspace que não sabe isolar a rede recusa com erro, em vez de deixá-la aberta. O agente não importa o `network`: só passa as opções acima.

### O caminho de uma conexão

1. **A CLI abre uma conexão.** Ela recebeu `HTTP_PROXY`, `HTTPS_PROXY` e `ALL_PROXY` apontando para `127.0.0.1:3128` (`NetworkBoundary.environment()`). `NO_PROXY` só tem o loopback da própria sandbox.
2. **O bridge recebe** em `127.0.0.1:3128`, dentro da sandbox, e passa os bytes como estão para o socket unix do proxy, no host.
3. **O proxy identifica o destino.** Num `CONNECT api.anthropic.com:443`, o destino é a autoridade; num pedido HTTP comum, a URL absoluta. Destino ilegível: `502`.
4. **O gate decide** (`NetworkGate.decide`), nesta ordem:
   1. **`alwaysAllow`** (num agente, os endereços do provider, como a API do modelo): sempre libera, **mesmo com um `deny` na política**, e não grava;
   2. **`alwaysDeny`** (num agente, a nuvem da CLI quando o modelo é local): nega, sem perguntar e sem gravar;
   3. **as regras de rede** (`decideByRules`): `allow` libera; uma regra `deny` nega e vence qualquer aprovação;
   4. **aprovação salva**, pelo _ledger_ (`ledger.approval`): no agente, da sessão (em memória) ou do store (`once`, que é consumida, ou `workspace`). Sem ledger, só valem as aprovações dadas a este gate;
   5. **o `default` da política**: se nega, o ledger registra como **pendente** e o gate responde ao agente "aguarda a aprovação de uma pessoa (pedido #N)". Sem ledger, nega sem número de pedido;
   6. **`requireApproval`**: pergunta a quem aprova (`approve`), **uma pergunta de cada vez**; várias conexões ao mesmo destino esperam a mesma resposta.
5. **O proxy age.** Negado: `403` com o motivo, que é o que a CLI vê. Liberado: abre a conexão de verdade, a partir do host, e liga os dois lados.

Toda decisão sai do gate por dois caminhos, que ele mesmo escolhe:

- **um evento** do produtor `network` (`type: 'decision'`), para quem assinar. Os dados são o destino, `decision`, `reason` e `decidedBy` (qual etapa decidiu: `provider` para `alwaysAllow`/`alwaysDeny`, `policy`, `saved`, `default` ou `human`);
- **o log** (`network_decision`): as negações em `error`, gravadas mesmo sem `debug`, menos as do provider, que são tráfego de fundo da CLI; o resto em `debug`.

Uma conexão liberada que falha no destino (DNS, recusada) vira `network_failure` no log, e a CLI recebe `502`.

### Padrões de host

`hosts` na política aceita `host` ou `host:porta`, com `*`:

- `github.com` vale para **qualquer porta**; `github.com:443`, só para ela;
- `*.github.com` cobre os subdomínios, não o próprio `github.com`;
- uma URL (`https://…`) é **recusada** ao criar o gate: nunca casaria com um destino.

### localhost tem dois sentidos

Dentro da sandbox, `localhost` é a **própria sandbox**. Para chegar a um serviço do **host**:

- os endpoints locais do provider (o Ollama em `127.0.0.1:11434`) e cada `localhost:<porta>` exato na política viram um `--forward`: o bridge escuta esse endereço dentro e o leva ao host por um `CONNECT`, que o gate também decide;
- `localhost:*` **não** abre todas as portas: só portas exatas viram túnel.

E o contrário, chegar **do host** a um serviço da sandbox (um dev server que o agente subiu), é o `ports` do workspace (`publish.ts`). A mesma porta não pode estar nos dois: o `NetworkBoundary.publish` recusa.

### bubblewrap e docker

|                 | bubblewrap                                                                   | docker                                                              |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Vida da sandbox | uma jaula para o workspace inteiro                                           | um container por comando                                            |
| Bridge          | `attach`: sobe uma vez, escreve o arquivo `ready` e morre junto com o Goiaba | `launcher`: abre a saída e então roda o comando, terminando com ele |

[↑ topo](#topo)

## Exemplos

Do mais simples ao mais completo. Os exemplos 1 e 2 rodam como estão: estão em `guides/network/exemplos/network.ts`.

### 1. Uma sandbox com a rede passando pelo gate (bubblewrap e docker)

Sem agente e sem modelo: uma sandbox, uma política e um `curl` lá dentro. É o menor uso completo do módulo.

```ts
import { NetworkBoundary } from '../../src/network/index';
import { Workspace } from '../../src/workspace/index';

// 1. A sandbox. A única linha que muda entre as duas:
const workspace = new Workspace({ type: 'bubblewrap', root });
// const workspace = new Workspace({ type: 'docker', root, image: 'FROM oven/bun:latest' });

// 2. A rede dela passa a ser só o proxy, que pergunta ao gate. Com uma política
//    inteira (que também precisa de `read /workspace/**`), este passo é
//    workspace.applyPermissions(policy, { approve }), como num agente.
workspace.configureNetwork(
  new NetworkBoundary({
    // Só as regras de rede (num agente: networkRulesOf(permissions)).
    rules: {
      default: 'deny',
      allow: [{ operations: ['connect'], hosts: ['example.com'] }],
      deny: [{ operations: ['*'], hosts: ['169.254.169.254'] }],
    },
    approve: () => Promise.resolve('deny'), // ninguém aprova nada aqui
    // sem ledger: nada é gravado; num agente, o store guarda as decisões
  }),
);

// 3. Qualquer comando preparado pelo workspace já sai pelo proxy.
const curl = await workspace.prepare({
  executable: 'curl',
  arguments: [
    '-s',
    '-o',
    '/dev/null',
    '-w',
    '%{http_code}',
    'https://example.com',
  ],
});
// … roda `curl` (o exemplo usa runProgram) …

await workspace.close(); // derruba proxy, bridge e sandbox
```

Rodando:

```
bun guides/network/exemplos/network.ts bubblewrap
bun guides/network/exemplos/network.ts docker
```

A saída é **igual nas duas** (saída real, docker):

```
curl https://example.com
   gate: example.com:443 → allow (policy)
   resposta: 200
curl https://www.wikipedia.org
   gate: www.wikipedia.org:443 → deny (default)
   resposta: 403
curl http://169.254.169.254
   gate: 169.254.169.254:80 → deny (policy)
   resposta: 403
curl --noproxy "*" https://example.com
   resposta: 000
```

| Tentativa           | Quem decidiu               | Resposta                       |
| ------------------- | -------------------------- | ------------------------------ |
| `example.com`       | a regra `allow`            | `200`: o proxy abriu a conexão |
| `www.wikipedia.org` | nenhuma regra: o `default` | `403` do proxy                 |
| `169.254.169.254`   | a regra `deny`             | `403` do proxy                 |
| `--noproxy`         | ninguém: o gate nem soube  | `000`: a sandbox não tem rede  |

A última linha é a garantia do módulo: **sem o proxy, não há caminho**. Não é um filtro; a sandbox simplesmente não tem rede (`--unshare-net` no bubblewrap, `--network none` no docker).

> Em HTTPS, o `403` é a resposta do proxy ao `CONNECT`. O `curl` a guarda em `%{http_connect}`, não em `%{http_code}` (que fica `000`). O exemplo mostra o do CONNECT nesse caso.

### 2. Ouvir as decisões

O gate é o produtor `network`. As linhas `gate: …` do Exemplo 1 vêm deste consumidor, que roda aqui, no host, e por isso vale igual para bubblewrap e docker:

```ts
import { createConsumer } from '../../src/events/index';
import { NETWORK_SOURCE } from '../../src/network/index';

const decisoes = createConsumer((event) => {
  if (event.type !== 'decision') return;
  // event.hostname, event.port, event.decision, event.decidedBy, event.reason
  // event.agent e event.run, se a conexão veio de um agente
});
decisoes.subscribe(NETWORK_SOURCE);
try {
  // … a sandbox trabalha …
} finally {
  decisoes.unsubscribeAll();
}
```

`decidedBy` diz qual etapa decidiu: `provider` (`alwaysAllow`/`alwaysDeny`), `policy`, `saved`, `default` ou `human`. O gate também grava o log (`network_decision`) por conta própria: o consumidor é para quem quer reagir, não para registrar.

### 3. Num agente: só a política

Num agente, não se monta `NetworkBoundary` nem `configureNetwork`: **o workspace faz isso sozinho, sempre que há `permissions`**, entregando ao `network` só `networkRulesOf(permissions)`. Basta escrever a política:

```ts
new Agent({
  name: 'assistente',
  prompt: '…',
  provider: new OllamaProvider({ cli: 'claude', model: 'qwen3.5:4b' }),
  workspace: new Workspace({ type: 'bubblewrap', root }), // ou docker
  permissions: {
    default: 'deny',
    allow: {
      filesystem: [{ operations: ['read', 'write'], paths: ['/workspace/**'] }],
      network: [{ operations: ['connect'], hosts: ['registry.npmjs.org'] }],
    },
  },
});
```

O que acontece com a rede desse agente:

- `registry.npmjs.org`: liberado pela regra;
- `127.0.0.1:11434` (o Ollama): liberado, porque é **endereço do provider**; o bridge leva esse endereço da sandbox até o host;
- qualquer outro: o `default` nega, e o pedido fica pendente na tela de aprovações;
- sem nenhuma regra de `network`, o `default: 'deny'` já fecharia tudo, menos o Ollama.

### 4. Uma política de rede completa

De `agents/permissions.ts`:

```ts
allow: {
  network: [
    {
      operations: ['connect'],
      hosts: ['github.com', '*.github.com', 'registry.npmjs.org', 'localhost:3000', 'localhost:5173'],
      ignores: { hosts: ['gist.github.com'] },
    },
  ],
},
requireApproval: {
  network: [
    {
      operations: ['connect'],
      hosts: ['*'],
      ignores: { hosts: ['www.google.com.br', '*.google.com', 'localhost', 'localhost:*'] },
    },
  ],
},
deny: {
  network: [{ operations: ['*'], hosts: ['169.254.169.254', 'metadata.google.internal'] }],
},
```

| Destino                  | Decisão                     | Por quê                                                       |
| ------------------------ | --------------------------- | ------------------------------------------------------------- |
| `registry.npmjs.org:443` | liberado                    | `allow`                                                       |
| `api.github.com:443`     | liberado                    | `allow`, `*.github.com` cobre subdomínios                     |
| `github.com:22`          | liberado                    | `allow`: `github.com` sem porta vale para todas               |
| `gist.github.com:443`    | pergunta                    | sai do `allow` pelo `ignores` e cai no `requireApproval: '*'` |
| `exemplo.com:443`        | pergunta                    | `requireApproval: '*'`                                        |
| `169.254.169.254:80`     | negado                      | `deny`: os metadados da nuvem, nunca                          |
| `localhost:5173`         | liberado, por túnel ao host | `allow` com porta exata vira `--forward`                      |

### 5. O gate sozinho

Para entender só a ordem de decisão, sem sandbox (como em `test/network.test.ts`):

```ts
const rules: NetworkRules = {
  default: 'deny',
  allow: [{ operations: ['connect'], hosts: ['registry.npmjs.org'] }],
  requireApproval: [{ operations: ['connect'], hosts: ['*.example.com'] }],
};
const gate = new NetworkGate({
  rules,
  alwaysAllow: ['api.anthropic.com:443'],
  approve: () => Promise.resolve('session'),
  // sem ledger: as aprovações valem só para este gate, e nada é gravado
});

const https = (hostname: string) => ({
  hostname,
  port: 443,
  protocol: 'https' as const,
});
await gate.decide(https('api.anthropic.com')); // allow  (provider: está em alwaysAllow)
await gate.decide(https('registry.npmjs.org')); // allow  (policy)
await gate.decide(https('a.example.com')); // allow  (human: perguntou, respondeu 'session')
await gate.decide(https('a.example.com')); // allow  (saved: já aprovado nesta sessão)
await gate.decide(https('outro.com')); // deny   (default)
```

O que está entre parênteses é o `decidedBy` de cada evento (saída real). Com um ledger no store (`ledger: networkLedger(store, { root, provider })`), a negação de `outro.com` ficaria **pendente**, com número de pedido, e a aprovação `session` seria guardada por ele. Só as regras, sem o gate, também respondem:

```ts
decideByRules(rules, 'registry.npmjs.org:443'); // { policy: 'allow', source: 'allow', … }
decideByRules(rules, 'outro.com:443'); // { policy: 'deny', source: 'default', … }
```

### 6. Quem aprova

A rede usa **o mesmo `approve` dos comandos**, para a pessoa ter uma fila só. O pedido chega com o destino como texto (`exemplo.com:443`) e `category: 'network'`, e o approver pode tratá-lo à parte, como o `sandboxApprover` do Instructor:

```ts
export const sandboxApprover: CommandApprover = ({ category }) =>
  Promise.resolve(category === 'network' ? 'deny' : 'once');
```

Só chega ao approver o que cai em `requireApproval`. Uma negação pelo `default` não pergunta: fica pendente para a tela de aprovações.

### 7. O que a CLI vê quando é negada

O proxy responde `403` com o motivo. Para uma negação pelo `default`:

```
Negado: este destino aguarda a aprovação de uma pessoa (pedido #42). Não tente de novo nem outro caminho para ele; continue com outra parte da tarefa ou termine o turno e espere.
```

A frase é escrita para o modelo: diz para não insistir e dá o número do pedido que aparece em `bun approvals`.

[↑ topo](#topo)

## Regras do módulo

**Só o módulo pode:**

- Ser a saída da sandbox. Com política, a sandbox não tem rede própria; o que ignora `HTTP_PROXY` (um `ssh`, um socket TCP direto) simplesmente não sai. O fechamento é por falta de caminho, não por um filtro que alguém precise lembrar de aplicar.
- Decidir destinos. Quem conecta é o proxy, no host, para o destino que o gate liberou: a CLI nunca escolhe o IP.

**Ninguém deve:**

- **Esquecer que, sem política, a rede é do host.** Um agente sem `permissions` não passa pelo gate. Com qualquer política, o `default` já vale para a rede.
- **Escrever URL em `hosts`.** O gate recusa na criação: `exemplo.com` ou `exemplo.com:443`.
- **Esperar que `localhost:*` abra o host.** Só porta exata vira túnel.
- **Pôr a mesma porta em `ports` e em `localhost:<porta>`.** Uma é da sandbox, a outra é do host; o módulo recusa.
- **Tentar negar pela política um destino de `alwaysAllow`.** Ele passa mesmo assim: num agente, são os endereços do provider, sem os quais a CLI não fala com o modelo.

[↑ topo](#topo)

## Exercícios

1. **Simples.** Com a política do Exemplo 4, o que acontece com `gist.github.com:443`, `api.npmjs.org:443` e `localhost:8080`? Para cada um, diga a regra que decidiu.

2. **Intermediário.** Um agente tem `default: 'deny'` e nenhuma regra de `network`. A CLI dele roda `curl https://exemplo.com`. A conexão passa pelo gate? Qual `decidedBy` aparece no evento, em que nível vai para o log, e o que a CLI recebe? E se o mesmo agente não tivesse `permissions`?

3. **Difícil.** Três conexões simultâneas para `a.example.com:443` chegam ao gate, e o destino está em `requireApproval`. Seguindo `decide`, `asking` e `enqueue`, explique quantas vezes a pessoa é perguntada e o que cada conexão recebe se ela responder `once`. Depois diga o que mudaria se a resposta fosse `session`.

[↑ topo](#topo)
