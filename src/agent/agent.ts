import type { AgentOptions, AgentProvider } from './types.js';
import { type AgentIO, TerminalAgentIO } from './io.js';
import { Executor } from '../execute/index.js';
import type { AgentEvent, ProviderEvent } from '../providers/types.js';
import type { Workspace } from '../workspace/index.js';

export class Agent {
  private readonly provider: AgentProvider;
  private readonly executor: Executor<string>;
  private readonly workspace: Workspace;
  private readonly prompt: string;
  private readonly io: AgentIO;

  public constructor({
    prompt,
    provider,
    workspace,
    io = new TerminalAgentIO(),
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
    this.io = io;
    this.executor = executor ?? new Executor({ output });
  }

  public async run(): Promise<void> {
    try {
      for await (const event of this.interact(
        this.prompt,
        (question) => this.io.ask(question),
      )) {
        if (event.type === 'output') {
          await this.io.write(event.value);
        }
      }
    } finally {
      await this.io.close();
    }
  }

  public async *interact(
    input: string,
    answer: (question: string) => Promise<string>,
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
