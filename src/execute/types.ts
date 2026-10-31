export interface ProgramCommand {
  readonly executable: string;
  readonly arguments?: readonly string[];
  readonly cwd?: string;
  readonly input?: string;
  /**
   * The program's whole environment; without it, it inherits Goiaba's. Set
   * by the sandbox, so secrets it does not let in are not there at all.
   */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ProgramOutput {
  readonly channel: 'stdout' | 'stderr';
  readonly chunk: string;
}
