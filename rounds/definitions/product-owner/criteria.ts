/**
 * Catálogo de TODAS as opções de `criteria` — os critérios de uma boa rodada,
 * conferidos pela própria rodada no fim de cada passo (o que hoje se chama
 * `instructions`).
 *
 * Cada agente (pelo nome) tem uma lista de critérios. Um critério tem UMA
 * chave, que diz o seu tipo:
 *   - `file`  — asserções sobre um arquivo (ou vários, com curinga);
 *   - `limit` — teto de tempo/tokens/custo;
 *   - `if`/`then`/`else` — condicional: confere um ramo ou o outro.
 * A chave de topo `round` traz os critérios da rodada inteira.
 *
 * Um `file` é "chato": todas as asserções nele valem juntas. Para ramificar
 * ("se existir … senão …") use o condicional, nunca aninhe condição dentro do
 * `file`. É referência: numa rodada real use só o que fizer sentido.
 */

export const criteria = {
  // Critérios de um agente, pelo nome do ator.
  'product-owner': [
    // ---------- Critério de ARQUIVO (todas as asserções valem juntas) ----------
    {
      file: {
        // Caminho relativo à raiz do workspace. Aceita curinga: `*`,
        // `src/**`, `tickets/ticket-*.md`.
        name: 'ticket.md',

        // Com curinga em `name`: arquivos a tirar do critério.
        ignore: ['*.tmp'],

        // --- existência, no fim do passo ---
        exists: true, // deve existir; `false` = não pode existir

        // --- mudança, comparada ao início (precisa de start no git) ---
        created: true, // passou a existir durante o passo
        deleted: false, // deixou de existir durante o passo
        changed: false, // false = o git não viu mudança; true = mudou

        // --- conteúdo (quando o arquivo existe) ---
        contains: ['Então', '#5f4e4e'], // contém TODOS estes trechos (ignora maiúsc./minúsc.)
        matches: [/#[0-9a-f]{6}/i], // casa TODAS estas expressões
        equals: '<h1>🚀 Goiaba</h1>', // o conteúdo é exatamente isto
      },
    },

    // ---------- Critério de MUITOS arquivos ----------
    // "Nenhum arquivo além do ticket.md pode ter mudado."
    { file: { name: '*', ignore: ['ticket.md'], changed: false } },

    // ---------- Critério CONDICIONAL (se / confira / senão) ----------
    // `if` é avaliado no INÍCIO do passo; confere `check` quando vale e `else`
    // quando não. `check`/`else` são listas de critérios (dá para aninhar).
    // (`then` seria uma chave proibida — objeto com `then` vira "thenable".)
    {
      if: { name: 'ticket.md', exists: true }, // condição: name + exists/contains
      check: [{ file: { name: 'ticket.md', changed: true } }], // existia → foi editado
      else: [{ file: { name: 'ticket.md', created: true } }], // não existia → foi criado
    },

    // ---------- Critério de LIMITE (deste agente) ----------
    {
      limit: {
        time: '20s', // tempo do agente: `'20s'`, `'2min'`
        tokens: 20000, // novos tokens do agente (input fresco + output)
        cost: '0.05', // custo do agente, em USD
      },
    },
  ],

  // Critérios da RODADA inteira (soma de todos os agentes).
  round: [{ limit: { time: '1min', tokens: 50000, cost: '0.10' } }],
};
