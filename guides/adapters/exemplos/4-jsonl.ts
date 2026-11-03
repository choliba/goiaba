/**
 * Exemplo 4 do curso de adapters: a conversa por um arquivo. O JsonlAdapter
 * lê as linhas que alguém acrescenta ao arquivo (cada uma, um evento) e
 * escreve no mesmo arquivo o que a conversa mostra (`{"out": …}`). Aqui,
 * quem acrescenta as linhas é o próprio exemplo, como outro programa faria.
 */
import { randomUUID } from 'node:crypto';

import { JsonlAdapter } from '../../../src/adapters/jsonl/index';
import { environment } from '../../../src/execute/process';
import {
  appendText,
  ensureDirectory,
  goiabaCacheDir,
  join,
  readText,
  removePath,
} from '../../../src/filesystem/index';
import { Conversation } from '../../../src/interaction/index';
import { stdioOutput } from '../../../src/output/index';

const dir = join(goiabaCacheDir(environment()), 'jsonl-exemplo', randomUUID());
ensureDirectory(dir);
const path = join(dir, 'conversa.jsonl');

try {
  const conversation = new Conversation(
    new JsonlAdapter({ path, pollMs: 20, startEmpty: true }),
  );
  conversation.write('Oi! Em que posso ajudar?');

  const asked = conversation.ask('');
  // Outro programa (ou uma pessoa) acrescenta uma linha ao arquivo.
  appendText(
    path,
    `${JSON.stringify({ type: 'message', text: 'resuma o README' })}\n`,
  );
  const message = await asked;

  conversation.reasoning('vou ler o README');
  conversation.stream('O README ');
  conversation.stream('explica o projeto.');
  conversation.close();
  await new Promise((resolve) => setTimeout(resolve, 20));

  await stdioOutput.write(`a conversa ouviu: ${message}`);
  await stdioOutput.write(`o arquivo:\n${readText(path).trimEnd()}`);
} finally {
  removePath(dir);
}
