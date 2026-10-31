# Módulo workspace: para que ele existe

O módulo `workspace` prepara comandos para rodarem dentro de um limite de execução. Em termos simples, ele define quais partes do computador um agente consegue ver e alterar enquanto usa um projeto, e como os comandos entram nesse ambiente.

O workspace mantém juntas a raiz do projeto, as permissões de arquivos, o acesso ao host e a configuração de rede. Ele escolhe uma implementação de sandbox: Docker ou Bubblewrap. Assim, quem executa um comando pede ao workspace que o prepare, sem precisar montar diretamente os detalhes de cada sandbox.

## Os arquivos

| Arquivo | Papel |
| --- | --- |
| `src/workspace/index.ts` | Define as opções e a classe `Workspace`; valida a raiz e as portas, cria o sandbox e encaminha as configurações e o ciclo de vida. |
| `src/workspace/sandbox/types.ts` | Define a interface `Sandbox` e o contrato `NetworkExit` usados pelas implementações. |
| `src/workspace/sandbox/index.ts` | Exporta os tipos e as implementações de Bubblewrap e Docker. |
| `src/workspace/sandbox/bubblewrap.ts` | Cria e mantém a jaula Bubblewrap, monta os caminhos, configura rede e prepara comandos com `nsenter`. |
| `src/workspace/sandbox/docker.ts` | Prepara comandos em contêineres Docker e define montagens, ambiente, rede e encerramento. |
| `src/workspace/sandbox/host-access.ts` | Decide quais diretórios, credenciais e variáveis do host são compartilhados com o sandbox. |
| `src/workspace/sandbox/host-state.ts` | Lista os diretórios de estado genéricos das ferramentas do host. |
| `src/workspace/sandbox/protect.ts` | Converte caminhos existentes em máscaras somente leitura. |
| `src/workspace/sandbox/wrap-command.ts` | Coloca um comando dentro de outro executável, preservando argumentos, diretório atual e entrada. |
| `src/workspace/sandbox/debug.ts` | Registra detalhes do comando e dados adicionais no log de depuração do sandbox. |

## Como funciona

1. `Workspace` recebe opções com tipo, raiz e, no caso de Docker, imagem. Rejeita raiz vazia, a raiz `/` e portas inválidas; então cria `DockerSandbox` ou `BubblewrapSandbox`.
2. Antes de executar, o chamador pode aplicar permissões de arquivos. `Workspace.applyPermissions` compila a política relativa à raiz e a entrega ao sandbox.
3. O chamador também pode configurar o acesso ao host, os caminhos protegidos e a saída de rede. O sandbox reúne essas configurações para definir suas montagens e seu ambiente.
4. Ao preparar um comando, `Workspace.prepare` fixa o diretório de trabalho na raiz e delega ao sandbox. Bubblewrap inicia ou reutiliza uma jaula e envolve o comando com `nsenter`; Docker monta o contêiner e envolve o comando com `docker run`. Nos dois casos, `wrapCommand` forma o comando externo.
5. Após o uso, `Workspace.close` encerra o sandbox e, se houver, a fronteira de rede configurada.

No Bubblewrap, a jaula é mantida viva durante a vida do workspace; comandos entram nela. No Docker, cada comando preparado usa um contêiner com remoção automática, e `close` também tenta remover à força o último contêiner registrado.

## Exemplo real

Em `src/agent/agent.ts`, a configuração das permissões entrega a política ao workspace e marca arquivos que devem continuar protegidos:

```ts
workspace.applyPermissions(permissions);
const network = configureNetwork({
  permissions,
  workspace,
  provider,
  approve,
});

// What enforces the policy stays read-only for the agent.
workspace.protect([
  ...(broker === undefined ? [] : [broker.dir]),
  ...cliFiles,
]);
```

`configureNetwork` também chama `workspace.configureNetwork(network)` quando há regras de rede. O trecho mostra a divisão de responsabilidades: `agent.ts` decide quais regras e caminhos se aplicam; o workspace encaminha essas decisões ao sandbox, que as aplica ao preparar o ambiente.

## Regras do módulo

- Só o workspace deve criar e configurar `DockerSandbox` ou `BubblewrapSandbox` e decidir qual deles corresponde às opções recebidas.
- Só o sandbox deve construir os detalhes de execução do isolamento: montagens, máscaras, ambiente do contêiner ou da jaula, e argumentos de entrada como `docker run` e `nsenter`.
- Quem usa o módulo deve passar permissões, caminhos protegidos, acesso ao host e fronteira de rede pelas operações de `Workspace`; não deve montar esses limites diretamente no comando do agente.
- A raiz do workspace não pode estar vazia nem resolver para `/`. O workspace raiz é gravável por padrão, exceto quando a política configura `workspaceAccess` como somente leitura.
- O compartilhamento do host é delimitado por `SandboxHost`: caminhos de estado, credenciais ocultadas e variáveis permitidas. Sem esse objeto, as implementações usam diretórios de estado genéricos e o ambiente padrão do processo.
- A rede isolada é opcional na interface `Sandbox`. `Workspace.configureNetwork` rejeita a configuração se a implementação não oferecer `isolateNetwork`.
- A configuração de permissões, caminhos protegidos, host e rede em Bubblewrap deve ocorrer antes do início da jaula. Depois disso, esses métodos lançam `UsageError`.

## Exercícios

1. Trace `Workspace.prepare` até `wrapCommand`. Descreva quais campos de `ProgramCommand` são preservados quando um comando é envolvido.
2. Compare os caminhos de rede de Bubblewrap e Docker: identifique o que `configureNetwork` passa para cada implementação e como os comandos entram na rede.
3. Acompanhe `sandboxHost` até as montagens e o ambiente de um sandbox. Explique como um arquivo de credencial conhecido pode ser ocultado e como uma variável pode ser incluída.
