export interface ProgramCommand {
  readonly executable: string;
  readonly arguments?: readonly string[];
  readonly cwd?: string;
  readonly input?: string;
}

export interface ProgramOutput {
  readonly channel: 'stdout' | 'stderr';
  readonly chunk: string;
}
