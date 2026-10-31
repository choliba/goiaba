import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';

describe('Agentes (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // Um servidor de agentes que não existe: aparece como fora do ar.
    process.env.AGENT_SERVERS = 'http://127.0.0.1:1';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('/api/agents (GET) lista os servidores, mesmo fora do ar', () => {
    return request(app.getHttpServer())
      .get('/api/agents')
      .expect(200)
      .expect([
        {
          id: 'http://127.0.0.1:1',
          name: 'http://127.0.0.1:1',
          url: 'http://127.0.0.1:1',
          online: false,
        },
      ]);
  });

  it('/api/agents/:id/mensagens (POST) recusa uma mensagem vazia', () => {
    return request(app.getHttpServer())
      .post('/api/agents/goiaba/mensagens')
      .send({})
      .expect(400);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.AGENT_SERVERS;
  });
});
