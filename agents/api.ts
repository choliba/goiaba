import {
  Agent,
  ensureDirectory,
  join,
  OllamaProvider,
  readText,
  StandardOutput,
  Workspace,
  type AgentOptions,
  type ApprovalScope,
  type CommandApprovalRequest,
  type OutputAdapter,
} from '../src/index';

/**
 * Vários agentes numa API só: cada um com o seu name, provider e modelo, a
 * sua pasta e a sua conversa. As rotas levam o id do agente:
 *
 *   GET  /agentes                  quem está aqui (o site descobre por ela)
 *   GET  /:agente/agente           name, provider e estado de um
 *   POST /:agente/mensagens        { "texto": "..." }
 *   GET  /:agente/eventos          mensagem, status, aprovacao (ao vivo)
 *   POST /:agente/aprovacoes/:id   { "resposta": "once" | ... }
 */

// Cada agente trabalha na sua pasta: um workspace aceita um agente por vez.
const pastas = process.env['workspace'] ?? '';

/**
 * O exemplo de "Agente básico" do docs/agents.md: o Desenvolvedor ensina com
 * o mesmo código da documentação, que é o que usamos aqui.
 */
function agenteBasico(): string {
  const doc = readText(join(import.meta.dir, '../docs/agents.md'));
  const secao = doc.slice(doc.indexOf('## Agente básico'));
  const codigo = /```ts\n([\s\S]*?)```/.exec(secao)?.at(1);
  return codigo?.trim() ?? '(o exemplo não foi encontrado em docs/agents.md)';
}
const AGENTES: readonly {
  readonly name: string;
  readonly provider: AgentOptions['provider'];
  /** Quem ele é e o assunto com que abre a conversa; o nome entra sozinho (veja `instrucoes`). */
  readonly prompt: string;
}[] = [
  {
    name: 'João carlos',
    provider: new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b' }),
    prompt: `Você é o atendente da Sitemark e conhece tudo sobre ela.
Fale apenas sobre a Sitemark; se perguntarem outro assunto, diga com educação que só atende sobre a Sitemark.
Abra a conversa falando sobre: acompanhe o desempenho do seu negócio.`,
  },
  {
    name: 'Desenvolvedor',
    provider: new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b' }),
    prompt: `Você é especialista em código e ensina a criar agentes com o Goiaba.
Este é o agente básico, o mesmo que usamos aqui:

\`\`\`ts
${agenteBasico()}
\`\`\`

Abra a conversa mostrando esse exemplo e perguntando como pode ajudar.`,
  },
  {
    name: 'Crarunha',
    provider: new OllamaProvider({ cli: 'codex', model: 'qwen3.5:4b' }),
    prompt: `Você é atendente da Sitemark.
Abra a conversa falando sobre: acompanhe o desempenho do seu negócio.`,
  },
];

/**
 * O que o agente recebe para começar: o nome dele, sempre, e o `prompt` da
 * definição. Não aparece na conversa; o que aparece é a abertura que ele faz.
 */
function instrucoes(name: string, prompt: string): string {
  return [
    // Só na abertura: nas respostas seguintes, sem repetir a apresentação.
    `Seu nome é ${name}. Apresente-se uma única vez, na abertura; nas respostas seguintes, não repita seu nome nem a apresentação: responda direto.`,
    prompt,
  ]
    .filter((linha) => linha.trim().length > 0)
    .join('\n');
}

/** Um evento no formato do Server-Sent Events. */
function linhaDe(evento: string, dados: unknown): string {
  return `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
}

/** O pedido para abrir a conversa, em vez de esperar a primeira mensagem. */
const ABERTURA =
  'Comece a conversa agora: apresente-se e puxe o assunto descrito acima, sem esperar uma pergunta.';
/** Quantos eventos da conversa ficam guardados por agente. */
const HISTORICO_MAXIMO = 500;

const RESPOSTAS: readonly ApprovalScope[] = [
  'once',
  'session',
  'workspace',
  'deny',
];

/** Um agente ligado à API: a sua fila, os seus eventos, as suas aprovações. */
interface AgenteNaApi {
  readonly id: string;
  readonly name: string;
  info(): unknown;
  chegou(texto: string): void;
  eventos(): Response;
  responder(pedido: number, resposta: ApprovalScope): boolean;
  /** Abre a conversa pelo assunto dele e conversa até ser parado. */
  conversar(): Promise<void>;
}

function criarAgenteNaApi({
  name,
  provider,
  prompt,
}: (typeof AGENTES)[number]): AgenteNaApi {
  const id = name.toLowerCase();

  // --- Entrada: mensagens que chegam pela API, esperando o agente lê-las.
  const fila: string[] = [];
  const leitores: ((texto: string) => void)[] = [];

  const proxima = (signal?: AbortSignal): Promise<string> => {
    const texto = fila.shift();
    if (texto !== undefined) return Promise.resolve(texto);

    return new Promise((resolve, reject) => {
      const leitor = (valor: string): void => {
        signal?.removeEventListener('abort', desistir);
        resolve(valor);
      };
      // Quem desiste de esperar sai da fila: a mensagem vai para o próximo.
      const desistir = (): void => {
        leitores.splice(leitores.indexOf(leitor), 1);
        reject(signal?.reason);
      };
      signal?.addEventListener('abort', desistir, { once: true });
      leitores.push(leitor);
    });
  };

  // --- Saída: eventos para quem acompanha (Server-Sent Events).
  const clientes = new Set<ReadableStreamDefaultController<string>>();
  /** A conversa até aqui, para quem abre o painel depois (ou recarrega). */
  const historico: string[] = [];
  let statusAtual: string | null = null;
  const enviar = (
    evento: string,
    dados: unknown,
    { guardar = false } = {},
  ): void => {
    const linha = linhaDe(evento, dados);
    if (guardar) {
      historico.push(linha);
      if (historico.length > HISTORICO_MAXIMO) historico.shift();
    }
    for (const cliente of clientes) cliente.enqueue(linha);
  };

  // --- Aprovações: cada pedido espera a resposta que chegar pela API.
  /** Pedidos esperando resposta, com o evento que os mostra. */
  const pendentes = new Map<
    number,
    {
      readonly linha: string;
      readonly resolver: (resposta: ApprovalScope) => void;
    }
  >();
  let ultimoPedido = 0;
  const aprovarPelaApi = (
    pedido: CommandApprovalRequest,
  ): Promise<ApprovalScope> => {
    ultimoPedido += 1;
    const numero = ultimoPedido;
    const dados = { id: numero, ...pedido };
    enviar('aprovacao', dados);
    return new Promise((resolve) =>
      pendentes.set(numero, {
        linha: linhaDe('aprovacao', dados),
        resolver: resolve,
      }),
    );
  };

  // --- O agente: a conversa e as aprovações passam pela API.
  const interaction: OutputAdapter = {
    write: (texto) => {
      enviar('mensagem', { texto }, { guardar: true });
    },
    ask: (_pergunta, signal) => proxima(signal),
    listen: (signal) => proxima(signal),
    status: (texto) => {
      statusAtual = texto ?? null;
      enviar('status', { texto: statusAtual });
    },
  };
  const root = join(pastas, id);
  ensureDirectory(root);
  const workspace = new Workspace({ type: 'bubblewrap', root });
  /** Criado com a primeira mensagem que chegar: a conversa começa por ela. */
  let agente: Agent | undefined;

  return {
    id,
    name,
    info: () => ({
      id,
      name,
      provider: provider.describe?.() ?? { name: provider.id },
      // Antes de começar, ainda não há conversa.
      status: agente?.status() ?? 'idle',
    }),
    chegou: (texto) => {
      // Também na conversa guardada: quem recarrega vê o que você disse.
      enviar('voce', { texto }, { guardar: true });
      const leitor = leitores.shift();
      if (leitor === undefined) fila.push(texto);
      else leitor(texto);
    },
    eventos: () => {
      let cliente: ReadableStreamDefaultController<string> | undefined;
      const stream = new ReadableStream<string>({
        start: (controller) => {
          cliente = controller;
          clientes.add(controller);
          // Um comentário na hora: os cabeçalhos saem sem esperar o
          // primeiro evento (um proxy, como o do site, espera por eles).
          controller.enqueue(': conectado\n\n');
          // A conversa desde o começo: quem chega agora não perde nada.
          controller.enqueue(linhaDe('inicio', {}));
          for (const linha of historico) controller.enqueue(linha);
          for (const { linha } of pendentes.values()) controller.enqueue(linha);
          if (statusAtual !== null) {
            controller.enqueue(linhaDe('status', { texto: statusAtual }));
          }
        },
        cancel: () => {
          if (cliente !== undefined) clientes.delete(cliente);
        },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    },
    responder: (pedido, resposta) => {
      const pendente = pendentes.get(pedido);
      if (pendente === undefined) return false;
      pendentes.delete(pedido);
      pendente.resolver(resposta);
      // Some dos outros painéis abertos também.
      enviar('aprovacao_respondida', { id: pedido });
      return true;
    },
    conversar: async () => {
      // Começa sozinho: quem ele é e o assunto com que abre a conversa.
      agente = new Agent({
        name: name,
        prompt: `${instrucoes(name, prompt)}\n\n${ABERTURA}`,
        provider,
        workspace,
        interaction,
        approve: aprovarPelaApi,
      });
      await agente.run();
    },
  };
}

const agentes = new Map(
  AGENTES.map((definicao) => {
    const agente = criarAgenteNaApi(definicao);
    return [agente.id, agente] as const;
  }),
);

async function textoDe(
  request: Request,
  campo: string,
): Promise<string | undefined> {
  const corpo: unknown = await request.json().catch(() => undefined);
  if (typeof corpo !== 'object' || corpo === null) return undefined;
  const valor: unknown = Reflect.get(corpo, campo);
  return typeof valor === 'string' ? valor : undefined;
}

function semAgente(id: string): Response {
  return new Response(`Não há agente ${id} aqui.`, { status: 404 });
}

const servidor = Bun.serve({
  port: Number(process.env['API_PORT'] ?? 3001),
  // /eventos fica parado entre um evento e outro: sem tempo-limite.
  idleTimeout: 0,
  routes: {
    '/agentes': {
      GET: () =>
        Response.json([...agentes.values()].map((agente) => agente.info())),
    },
    '/:agente/agente': {
      GET: (request) => {
        const agente = agentes.get(request.params.agente);
        return agente === undefined
          ? semAgente(request.params.agente)
          : Response.json(agente.info());
      },
    },
    '/:agente/mensagens': {
      POST: async (request) => {
        const agente = agentes.get(request.params.agente);
        if (agente === undefined) return semAgente(request.params.agente);
        const texto = await textoDe(request, 'texto');
        if (texto === undefined) return new Response('texto?', { status: 400 });
        agente.chegou(texto);
        return new Response(null, { status: 202 });
      },
    },
    '/:agente/eventos': {
      GET: (request) => {
        const agente = agentes.get(request.params.agente);
        return agente === undefined
          ? semAgente(request.params.agente)
          : agente.eventos();
      },
    },
    '/:agente/aprovacoes/:id': {
      POST: async (request) => {
        const agente = agentes.get(request.params.agente);
        if (agente === undefined) return semAgente(request.params.agente);
        const texto = await textoDe(request, 'resposta');
        const resposta = RESPOSTAS.find((valor) => valor === texto);
        if (
          resposta === undefined ||
          !agente.responder(Number(request.params.id), resposta)
        ) {
          return new Response('pedido ou resposta inválidos', { status: 400 });
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});

new StandardOutput().write(
  `API dos agentes ${[...agentes.values()].map((agente) => agente.id).join(', ')} em ${servidor.url.href}`,
);

// Todos ao mesmo tempo, cada um esperando a sua primeira mensagem.
await Promise.all([...agentes.values()].map((agente) => agente.conversar()));
await servidor.stop();
