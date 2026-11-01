---
name: guias-exemplos-completos
description: Como escrever (ou revisar) um curso de módulo em guides/<modulo>/curso.md — todo exemplo é completo e roda como está (imports, dados, chamada e saída real), nunca um fragmento; e o formato do curso (índice, link para o topo, seção de Interface). Use ao criar ou atualizar qualquer guia em guides/.
argument-hint: 'O módulo do curso (ex.: policy, network) ou o caminho do guia a revisar.'
user-invocable: true
disable-model-invocation: false
---

# Cursos em guides/: exemplos completos

## A regra

Cada exemplo de código num curso (`guides/<modulo>/curso.md`) deve ser **completo e executável como está**:

- os **imports**;
- os **dados** que usa (a política, as regras, o que for), escritos no próprio exemplo;
- a **chamada**;
- a **saída real**, de uma execução de verdade.

Nada de fragmentos que dependem de variáveis de outro exemplo (`policy.checkCommand(...)` solto) nem de chamada
sem import (`delegatedCategories({...})` sozinho). Um exemplo assim **não é removido: é completado**.

**Por quê:** o Exemplo 5 do curso de policy ("O que fica para o provider") era um trecho sem import nem contexto,
que não rodava copiado. Quem lê o curso precisa poder copiar o exemplo e ver a mesma saída.

## Como fazer

1. Escreva cada exemplo como um arquivo em `agents/meus-testes/<modulo>-exemplos/<n>-<nome>.ts`, com um
   comentário dizendo de qual exemplo do curso ele é.
2. Rode cada arquivo (`bun agents/meus-testes/<modulo>-exemplos/<arquivo>.ts`). Os que pedem resposta, rode com
   a entrada no stdin (`printf 's\n' | bun …`).
3. No curso, cole **o arquivo inteiro** e **a saída dessa execução**, com o caminho do arquivo acima do código.
4. Exemplos que não dá para rodar aqui (precisam de um modelo, de rede externa): ainda completos, e ao menos
   passando no `bun run typecheck`. Diga no curso o que eles precisam para rodar.
5. Saída pelo terminal do Goiaba (`writeOut`, `StandardOutput`), não `console`: a regra de I/O centralizado vale
   também para os exemplos.

## O formato do curso

- `<a id="topo"></a>` no início e um **[↑ topo](#topo)** no fim de cada seção `##` (não logo depois do índice).
- **Índice** logo depois da abertura, com todas as seções e subseções. Exemplos com várias partes ganham índice
  próprio, repetido no começo do exemplo.
- Seções: abertura (o conceito central do módulo, não um cenário de agente), **Os arquivos**, **Interface** (o que
  o módulo exporta: classes, funções, tipos), **Como funciona**, **Exemplos** (do mais simples ao mais completo; o
  agente pode aparecer como um dos usos, não como o centro), **Regras do módulo**, **Exercícios**.
- Antes de entregar: conferir que nenhum link do índice está quebrado e rodar o `prettier` no arquivo.
