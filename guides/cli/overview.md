# Visão Geral

O módulo "cli" contém dois arquivos principais: `approvals.ts` e `selection.ts`. O arquivo `approvals.ts` define um comando para listar e aprovar comandos negados pelo gate, enquanto o arquivo `selection.ts` fornece funções para analisar seleções interativas.

## Arquitetura & Tipos Principais

### approvals.ts

- **ApprovalReview**: Classe responsável por gerenciar a revisão e aprovação de comandos negados.
- **defineCommand**: Função que define um novo comando.
- **runCommand**: Função que executa um comando.
- **getConfig**: Função que obtém a configuração atual.
- **Store**: Classe para gerenciar o armazenamento de dados.
- **resolve**: Função para resolver caminhos de arquivo.

### selection.ts

- **parseSelection**: Função que analisa seleções interativas como `1,3,5-8`.
- **UsageError**: Classe para representar erros de uso.

## Exemplo de Uso Prático

Para listar e aprovar comandos negados pelo gate, execute o seguinte comando:

```sh
bun run approvals --root <dir>
```

Substitua `<dir>` pelo caminho do workspace desejado.

## Considerações de Execução

- O comando `run approvals` lista os comandos negados pelo gate e permite a seleção e aprovação interativa.
- A seleção de comandos é feita usando notações como `1,3,5-8`.
- O comando pode ser interrompido e retomado na próxima execução, caso o agente esteja parado.
- Dentro de um agente em execução, pressione `Ctrl+A` para abrir a mesma tela de seleção.