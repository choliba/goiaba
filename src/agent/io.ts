import { createInterface, type Interface } from 'node:readline/promises';

export interface AgentIO {
  write(value: string): void | Promise<void>;
  ask(question: string): Promise<string>;
  close(): void | Promise<void>;
}

export class TerminalAgentIO implements AgentIO {
  private terminal: Interface | undefined;

  public write(value: string): void {
    process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
  }

  public ask(question: string): Promise<string> {
    this.terminal ??= createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return this.terminal.question(`${question}\n> `);
  }

  public close(): void {
    this.terminal?.close();
    this.terminal = undefined;
  }
}
