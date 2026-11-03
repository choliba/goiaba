<a id="topo"></a>

# Módulo workspace: preparar um ambiente isolado

Um `Workspace` define a raiz que o agente pode alterar e prepara cada comando para executá-lo dentro de um sandbox. Também reúne as permissões de filesystem, a fronteira de rede e o acesso declarado pelo provider ao estado da CLI no host.

## Índice

- [Os arquivos](#os-arquivos)
- [Interface](#interface)
- [Como funciona](#como-funciona)
- [Exemplos](#exemplos)
  - [1. Homes persistentes e modos de hostState](#1-homes-persistentes-e-modos-de-hoststate)
- [Regras do módulo](#regras-do-módulo)
- [Exercícios](#exercícios)

## Os arquivos

| Arquivo                                | Papel                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/workspace/index.ts`               | `Workspace`: valida opções, escolhe sandbox, fixa diretório de trabalho, calcula o home por raiz e encaminha permissões e rede. |
| `src/workspace/sandbox/types.ts`       | Contratos de `Sandbox` e da saída de rede.                                                                                      |
| `src/workspace/sandbox/bubblewrap.ts`  | Montagens, jaula persistente e comandos que entram com `nsenter`.                                                               |
| `src/workspace/sandbox/docker.ts`      | Contêineres, montagens, ambiente e rede do Docker.                                                                              |
| `src/workspace/sandbox/host-access.ts` | Traduz o contrato do provider e `hostState` em home, credenciais, ambiente e caminhos visíveis.                                 |
| `src/workspace/sandbox/host-state.ts`  | Caminhos genéricos de estado que o sandbox compartilha quando não recebe um contrato de host.                                   |

[↑ topo](#topo)

## Interface

| Exportação                           | O que faz                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `Workspace`                          | Representa a raiz e o sandbox escolhido (`bubblewrap` ou `docker`).                             |
| `WorkspaceOptions`                   | Recebe `type`, `root`, caminhos graváveis, portas, imagem do Docker e `hostState`.              |
| `Workspace.home()`                   | Retorna o home persistente daquela raiz em `homes.dir`; raízes iguais produzem o mesmo caminho. |
| `Workspace.applyPermissions(policy)` | Compila as permissões de filesystem e configura a fronteira de rede opcional.                   |
| `Workspace.useHost(host)`            | Passa ao sandbox o conjunto já calculado de montagens e variáveis.                              |
| `Workspace.protect(paths)`           | Mantém arquivos de configuração e hooks somente para leitura.                                   |
| `Workspace.prepare(command)`         | Prepara o comando com o diretório de trabalho da raiz.                                          |
| `Workspace.close()`                  | Encerra sandbox e rede.                                                                         |

`hostState` aceita três valores. `login` é o padrão: a CLI ganha um home por workspace e somente seu arquivo de login entra, montado para leitura. `none` não compartilha arquivos de login e exige uma variável de credencial declarada pelo provider; um provider local sem credenciais continua válido. `share` entrega o estado do provider no host, gravável, incluindo o histórico de outras raízes.

O diretório dos homes é configurado por `homes.dir` em `goiaba.config.ts`; o padrão é `.goiaba/homes`. O diretório que contém todos os homes fica oculto dentro do sandbox se estiver dentro da raiz do workspace.

O cache do Goiaba (`~/.cache/goiaba`) também fica fora do sandbox, em qualquer `hostState`: lá ficam os gates dos outros agentes e homes antigos de CLIs. Do cache, o sandbox vê só o que é do próprio agente: o diretório do gate de execução, somente leitura, e o da saída de rede.

[↑ topo](#topo)

## Como funciona

1. `Workspace` valida a raiz e `hostState`, depois cria o sandbox adequado.
2. `home()` calcula um identificador estável a partir do caminho resolvido da raiz. O home guarda sessões e configuração da CLI entre execuções.
3. O agente consulta `provider.hostAccess()` e prepara o acesso conforme `hostState`. O sandbox recebe o resultado por `useHost`.
4. O agente passa as permissões, os caminhos protegidos e a rede por operações de `Workspace`.
5. `prepare` define `cwd` como a raiz e delega ao sandbox. `close` encerra os recursos.

Claude recebe `CLAUDE_CONFIG_DIR` apontando para `.claude` no home isolado; Codex recebe `CODEX_HOME` apontando para `.codex`. Quando `share` é escolhido com gate de execução do Codex, o gate também usa o `CODEX_HOME` compartilhado do host.

[↑ topo](#topo)

## Exemplos

### 1. Homes persistentes e modos de hostState

O exemplo cria workspaces sem iniciar uma CLI ou sandbox. Mostra que o padrão é `login`, que cada raiz ganha um home estável e que a escolha de `hostState` fica nas opções.

`guides/workspace/exemplos/1-homes.ts`:

```ts
/** Exemplo 1 do curso de workspace: homes persistentes e hostState. */
import { getConfig } from '../../../src/config/index';
import { writeOut } from '../../../src/output/stdio';
import { Workspace } from '../../../src/workspace/index';

const root = '/workspace/app';
const login = new Workspace({ type: 'bubblewrap', root });
const sameRoot = new Workspace({
  type: 'bubblewrap',
  root: '/workspace/./app',
});
const isolated = new Workspace({
  type: 'bubblewrap',
  root,
  hostState: 'none',
});
const shared = new Workspace({
  type: 'bubblewrap',
  root,
  hostState: 'share',
});
const homesDir = getConfig().homes.dir;

writeOut(`hostState padrão: ${login.hostState}\n`);
writeOut(`home: ${login.home().replace(homesDir, '<homes>')}\n`);
writeOut(
  `mesma raiz, mesmo home: ${String(login.home() === sameRoot.home())}\n`,
);
writeOut(`hostState sem login: ${isolated.hostState}\n`);
writeOut(`hostState compartilhado: ${shared.hostState}\n`);
```

```text
hostState padrão: login
home: <homes>/af7e243d70b1613d
mesma raiz, mesmo home: true
hostState sem login: none
hostState compartilhado: share
```

O nome do diretório é um hash da raiz resolvida; o mesmo caminho normalizado sempre resulta no mesmo home. O diretório de todos os homes é ocultado dentro do sandbox quando está sob a raiz do projeto.

[↑ topo](#topo)

## Regras do módulo

- Só `Workspace` escolhe e configura `DockerSandbox` ou `BubblewrapSandbox`.
- Quem usa workspace passa política, caminhos protegidos, host e rede por suas operações; não monta esses limites à mão no comando do agente.
- A raiz não pode ser vazia nem `/`.
- O provider descreve o que precisa do host; `Workspace` aplica somente a parte permitida pelo `hostState` escolhido.
- Configure filesystem, host e rede antes de iniciar a jaula Bubblewrap.

[↑ topo](#topo)

## Exercícios

1. Crie dois workspaces com raízes equivalentes após normalização. Compare `home()` e explique por que a sessão da CLI pode continuar entre execuções.
2. Escolha `hostState: 'none'` para um provider de nuvem. Quais variáveis declaradas pelo provider precisam estar configuradas?
3. Compare o que entra no sandbox em `login` e `share`. Que dado de outros projetos passa a ficar disponível em `share`?

[↑ topo](#topo)
