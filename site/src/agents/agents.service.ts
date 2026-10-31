import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

/** Respostas aceitas para um pedido de aprovação do agente. */
export const RESPOSTAS = ['once', 'session', 'workspace', 'deny'] as const;
export type Resposta = (typeof RESPOSTAS)[number];

/** Um agente que o site conhece, e se ele está no ar. */
export interface AgenteListado {
  /** O id do agente no seu servidor: é ele que vai nas rotas (/api/agents/:id/...). */
  readonly id: string;
  /** O nome que o agente diz ter; o id, enquanto ele está fora do ar. */
  readonly name: string;
  readonly url: string;
  readonly online: boolean;
  /** Provider, modelo e CLI, quando ele está no ar. */
  readonly provider?: unknown;
  readonly status?: unknown;
}

const PADRAO = 'http://127.0.0.1:3001';
const TEMPO_DA_CONSULTA_MS = 1500;

/**
 * Fala com os servidores de agentes (agents/api.ts), que rodam no Bun: o
 * Goiaba precisa dele, e este backend roda no Node. Quais servidores vem de
 * AGENT_SERVERS (separados por vírgula); os agentes de cada um, de
 * `GET /agentes` nele.
 */
@Injectable()
export class AgentsService {
  private readonly servidores = (process.env.AGENT_SERVERS ?? PADRAO)
    .split(',')
    .map((url) => url.trim().replace(/\/+$/, ''))
    .filter((url) => url.length > 0);
  /** id → endereço do agente, da última vez que os servidores foram perguntados. */
  private enderecos = new Map<string, string>();

  /** Os agentes de todos os servidores; um servidor fora do ar aparece como tal. */
  public async listar(): Promise<AgenteListado[]> {
    const porServidor = await Promise.all(
      this.servidores.map(async (servidor): Promise<AgenteListado[]> => {
        try {
          const resposta = await fetch(`${servidor}/agentes`, {
            signal: AbortSignal.timeout(TEMPO_DA_CONSULTA_MS),
          });

          const lista = (await resposta.json()) as {
            id?: unknown;
            name?: unknown;
            provider?: unknown;
            status?: unknown;
          }[];
          return lista
            .filter((item) => typeof item.id === 'string')
            .map((item) => {
              const id = String(item.id);
              return {
                id,
                name: typeof item.name === 'string' ? item.name : id,
                url: `${servidor}/${encodeURIComponent(id)}`,
                online: true,
                provider: item.provider,
                status: item.status,
              };
            });
        } catch {
          return [
            { id: servidor, name: servidor, url: servidor, online: false },
          ];
        }
      }),
    );
    const agentes = porServidor.flat();
    this.enderecos = new Map(
      agentes
        .filter((agente) => agente.online)
        .map((agente) => [agente.id, agente.url]),
    );
    return agentes;
  }

  public async enviarMensagem(id: string, texto: string): Promise<void> {
    await this.chamar(id, '/mensagens', { texto });
  }

  public async responderAprovacao(
    id: string,
    pedido: string,
    resposta: Resposta,
  ): Promise<void> {
    await this.chamar(id, `/aprovacoes/${encodeURIComponent(pedido)}`, {
      resposta,
    });
  }

  /** O stream de eventos do agente; `signal` o encerra. */
  public async eventos(
    id: string,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const resposta = await this.buscar(id, '/eventos', { signal });
    if (resposta.body === null) {
      throw new BadGatewayException(`O agente ${id} não enviou eventos.`);
    }
    return resposta.body;
  }

  private async chamar(
    id: string,
    caminho: string,
    corpo: unknown,
  ): Promise<void> {
    const resposta = await this.buscar(id, caminho, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (!resposta.ok) {
      throw new BadGatewayException(
        `O agente ${id} recusou: ${String(resposta.status)} ${await resposta.text()}`,
      );
    }
  }

  private async buscar(
    id: string,
    caminho: string,
    init: RequestInit,
  ): Promise<Response> {
    // Um agente novo num servidor: pergunta de novo antes de dizer que não há.
    if (!this.enderecos.has(id)) await this.listar();
    const url = this.enderecos.get(id);
    if (url === undefined) {
      throw new NotFoundException(`Não há agente ${id} no ar.`);
    }
    try {
      return await fetch(`${url}${caminho}`, init);
    } catch {
      throw new BadGatewayException(
        `O agente ${id} não está rodando em ${url}.`,
      );
    }
  }
}
