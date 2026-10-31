import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Request, Response } from 'express';

import {
  AgentsService,
  RESPOSTAS,
  type AgenteListado,
} from './agents.service.js';

/** Os agentes pela API do site: /api/agents/... */
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  /** Os agentes que o site conhece, e quais estão no ar. */
  @Get()
  listar(): Promise<AgenteListado[]> {
    return this.agents.listar();
  }

  /** Uma mensagem para o agente: { "texto": "..." }. */
  @Post(':id/mensagens')
  @HttpCode(202)
  async mensagem(
    @Param('id') id: string,
    @Body() corpo: { texto?: unknown },
  ): Promise<void> {
    if (typeof corpo.texto !== 'string' || corpo.texto.trim().length === 0) {
      throw new BadRequestException('Envie { "texto": "..." }.');
    }
    await this.agents.enviarMensagem(id, corpo.texto);
  }

  /** A resposta a um pedido de aprovação: { "resposta": "once" | ... }. */
  @Post(':id/aprovacoes/:pedido')
  @HttpCode(204)
  async aprovacao(
    @Param('id') id: string,
    @Param('pedido') pedido: string,
    @Body() corpo: { resposta?: unknown },
  ): Promise<void> {
    const resposta = RESPOSTAS.find((valor) => valor === corpo.resposta);
    if (resposta === undefined) {
      throw new BadRequestException(
        `Envie { "resposta": ${RESPOSTAS.map((valor) => `"${valor}"`).join(' | ')} }.`,
      );
    }
    await this.agents.responderAprovacao(id, pedido, resposta);
  }

  /** O que o agente faz, ao vivo (Server-Sent Events): mensagem, status, aprovacao. */
  @Get(':id/eventos')
  async eventos(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const fim = new AbortController();
    request.on('close', () => fim.abort());

    const stream = await this.agents.eventos(id, fim.signal);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.flushHeaders();

    Readable.fromWeb(stream as NodeReadableStream<Uint8Array>)
      .on('error', () => response.end())
      .pipe(response);
  }
}
