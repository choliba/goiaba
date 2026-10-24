import { createInterface } from 'node:readline/promises';

import type { AgentAsk, AgentOptions, AgentProvider } from './types.js';
import { Executor } from '../execute/index.js';
import type { AgentEvent } from '../providers/types.js';
import type { Workspace } from '../workspace/index.js';

export class Agent {
  private readonly provider: AgentProvider;
  private readonly executor: Executor<string>;
  private readonly workspace: Workspace;
  private readonly prompt: string;
  private readonly ask: AgentAsk;

  public constructor({
    prompt,
    provider,
    workspace,
    ask = askFromTerminal,
    executor,
    output,
  }: AgentOptions) {
    if (prompt.trim().length === 0) {
      throw new Error('O prompt do agente não pode estar vazio.');
    }

    if (executor !== undefined && output !== undefined) {
      throw new Error('Informe executor ou output, não ambos.');
    }

    this.provider = provider;
    this.workspace = workspace;
    this.prompt = prompt;
    this.ask = ask;
    this.executor = executor ?? new Executor({ output });
  }

  public async run(): Promise<void> {
    for await (const event of this.interact(this.prompt, this.ask)) {
      if (event.type === 'output') {
        writeLine(event.value);
      }

      if (event.type === 'ask') {
        writeLine(event.question);
      }
    }
  }

  public async *interact(
    input: string,
    answer: AgentAsk,
  ): AsyncIterable<AgentEvent<string>> {
    let nextInput = input;
    let sessionId: string | undefined;

    while (true) {
      let pendingAnswer: Promise<string> | undefined;

      for await (const event of this.executor.run(
        this.provider,
        this.workspace,
        nextInput,
        sessionId,
      )) {
        if (event.type === 'session') {
          sessionId = event.id;
          continue;
        }

        yield event;

        if (event.type === 'ask' && pendingAnswer === undefined) {
          pendingAnswer = answer(event.question);
        }
      }

      if (pendingAnswer === undefined) {
        return;
      }

      if (sessionId === undefined) {
        throw new Error('O provider não informou o identificador da sessão.');
      }

      nextInput = await pendingAnswer;
    }
  }
}

function writeLine(value: string): void {
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
}

async function askFromTerminal(_question: string): Promise<string> {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await terminal.question('> ');
  } finally {
    terminal.close();
  }
}
