/**
 * Exemplo 5 do curso de mcp: acessar a web. `buscar_pagina` abre um
 * endereço e devolve o título e o tamanho da página. Como `run` roda no
 * processo do Goiaba, a rede da sandbox do agente fica fechada: quem decide
 * aonde a ferramenta vai é ela, com uma lista de sites permitidos. Para o
 * exemplo rodar sem internet e dar sempre a mesma saída, ele sobe um site
 * local; a ferramenta de verdade do projeto, com um navegador, é a
 * `fetch_web_content` (agents/tools/fetch-web-content.ts).
 */
import { ToolBroker, tool } from '../../../src/mcp/index';
import { writeOut } from '../../../src/output/stdio';

// Um site local, numa porta livre, com duas páginas.
const site = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/') {
      return new Response(
        '<html><head><title>Feira da Goiaba</title></head><body><h1>Ofertas</h1></body></html>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }
    return new Response('não achei', { status: 404 });
  },
});
const base = `http://127.0.0.1:${String(site.port)}`;

/** Os únicos sites aonde a ferramenta vai. */
const PERMITIDOS = new Set([`127.0.0.1:${String(site.port)}`]);

const buscarPagina = tool({
  name: 'buscar_pagina',
  description:
    'Abre uma página da web e devolve o status, o título e o tamanho dela.',
  input: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'O endereço completo.' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  run: async (input: { readonly url: string }) => {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new Error(`Endereço inválido: ${input.url}.`);
    }
    if (!PERMITIDOS.has(url.host)) {
      throw new Error(`Esta ferramenta não acessa ${url.host}.`);
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const html = await response.text();
    return {
      status: response.status,
      titulo: /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? null,
      bytes: html.length,
    };
  },
});

const broker = new ToolBroker({ tools: [buscarPagina], policy: undefined });

const urls = [`${base}/`, `${base}/precos`, 'https://exemplo.com/', 'goiaba'];
try {
  for (const url of urls) {
    const shown = url.replace(base, 'http://127.0.0.1:<porta>');
    const { text, isError } = await broker.call('buscar_pagina', { url });
    writeOut(
      `${shown}\n  ${isError ? 'erro' : 'ok'}: ${text.replace(/127\.0\.0\.1:\d+/, '127.0.0.1:<porta>')}\n`,
    );
  }
} finally {
  await broker.close();
  await site.stop();
}
