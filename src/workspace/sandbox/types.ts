import type { ProgramCommand } from '../../execute/types';
import type { FilesystemAccess } from '../../policy/index';
import type { SandboxHost } from './host-access';

/**
 * Defines how a program command is placed inside an execution boundary.
 * Implementations may wrap it with Docker, Bubblewrap, or another runtime.
 */
export interface Sandbox {
  configureFilesystem(access: FilesystemAccess): void;
  /**
   * Mounts paths outside the workspace read-only on top of the writable ones
   * (e.g. the execution gate's hook inside `~/.cache`), so the agent cannot
   * rewrite what enforces its own policy.
   */
  protect(paths: readonly string[]): void;
  /**
   * Only this share of the host: the CLI's state, without the credentials it
   * does not use, and exactly this environment. Without it, the generic CLI
   * state dirs and Goiaba's whole environment.
   */
  useHost?(host: SandboxHost): void;
  /**
   * Runs without network of its own: `exit` is the only way out. Sandboxes
   * that cannot do it leave the method out.
   */
  isolateNetwork?(exit: NetworkExit): void;
  prepare(command: ProgramCommand): ProgramCommand | Promise<ProgramCommand>;
  /** The agent's CLI started inside the sandbox (for debug logging). */
  started?(pid: number | undefined): void | Promise<void>;
  close?(): void | Promise<void>;
}

/** The way out of a sandbox without network (see `NetworkBoundary`). */
export interface NetworkExit {
  /** Variables commands in the sandbox need to use it. */
  environment(): readonly string[];
  /**
   * Starts it for a jail; `enter` puts a command in the jail's network. Again
   * for a new jail replaces the old one.
   */
  attach(enter: (command: ProgramCommand) => ProgramCommand): Promise<void>;
  /**
   * argv that opens it from inside the sandbox and then runs the command
   * given after it, for sandboxes started once per command.
   */
  launcher(): Promise<readonly string[]>;
  /**
   * Where it creates the published ports' sockets; a sandbox that sees the
   * host read-only mounts it writable.
   */
  portsDir(): string;
}
