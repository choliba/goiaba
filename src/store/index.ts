import { ensureDirectory, dirname } from '../filesystem/index';
import { NO_RULE_REASON } from '../policy/index';
import { Database } from 'bun:sqlite';

export type ApprovalScope = 'once' | 'session' | 'workspace' | 'deny';

/** What a decision or approval is about: a shell command or a destination. */
export type DecisionCategory = 'execution' | 'network';

export interface DecisionRecord {
  readonly session: string | undefined;
  readonly provider: string;
  readonly root: string;
  /** The command, or `host:port` for `network`. */
  readonly command: string;
  /** `execution` when left out. */
  readonly category?: DecisionCategory;
  readonly decision: 'allow' | 'deny';
  readonly source: 'policy' | 'default' | 'human' | 'saved';
  readonly scope?: ApprovalScope;
  readonly reason: string;
}

export interface StoredDecision extends DecisionRecord {
  readonly category: DecisionCategory;
  readonly id: number;
  /** First time it was decided. */
  readonly ts: string;
  /** A pending denial asked again counts here, not as a new row. */
  readonly attempts: number;
  /** Last time it was asked. */
  readonly lastTs: string;
}

export interface SessionCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
}

/** An approval given outside the run that asked for it (`bun goiaba approvals`). */
export interface StoredApproval {
  readonly id: number;
  readonly root: string;
  readonly session: string | null;
  /** Exact command (`once`) or command pattern (`workspace`). */
  readonly pattern: string;
  readonly kind: 'once' | 'workspace';
  readonly category: DecisionCategory;
  readonly createdAt: string;
  /** The denial it approved, when given from the approvals screen. */
  readonly decisionId?: number;
}

/**
 * A denial still waiting for a person (alias `d`): approvable (by the default
 * or a person, not by an explicit deny rule), not dismissed, not approved, the
 * same command not allowed later, and not from an abandoned session.
 */
const PENDING_DENIAL = `d.decision = 'deny' AND d.source IN ('default', 'human')
  AND d.dismissed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM approvals a
    WHERE a.decision_id = d.id AND a.revoked_at IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = d.session AND s.outcome = 'abandoned')
  AND NOT EXISTS (
    SELECT 1 FROM decisions later
    WHERE later.root = d.root AND later.command = d.command
      AND later.category = d.category AND later.decision = 'allow' AND later.id > d.id)`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  root TEXT NOT NULL,
  started_at DATETIME NOT NULL,
  executable TEXT,
  arguments TEXT,
  cwd TEXT,
  prompt TEXT,
  finished_at DATETIME,
  outcome TEXT,
  agent TEXT
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts DATETIME NOT NULL,
  session TEXT,
  provider TEXT NOT NULL,
  root TEXT NOT NULL,
  command TEXT NOT NULL,
  decision TEXT NOT NULL,
  source TEXT NOT NULL,
  scope TEXT,
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  last_ts DATETIME,
  dismissed_at DATETIME,
  category TEXT NOT NULL DEFAULT 'execution'
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root TEXT NOT NULL,
  session TEXT,
  pattern TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  consumed_at DATETIME,
  notified_at DATETIME,
  revoked_at DATETIME,
  decision_id INTEGER,
  category TEXT NOT NULL DEFAULT 'execution'
);
`;

export interface NewSession {
  readonly id: string;
  readonly provider: string;
  readonly root: string;
  /** The agent's task; a different prompt is a new task, not a resume. */
  readonly prompt: string;
  /** Name of the agent that ran it. */
  readonly agent?: string;
  readonly command?: SessionCommand;
}

export interface NewApproval {
  readonly root: string;
  /** Exact command (`once`) or command pattern (`workspace`). */
  readonly pattern: string;
  readonly kind: 'once' | 'workspace';
  /** `execution` when left out. */
  readonly category?: DecisionCategory;
  readonly session?: string | undefined;
  /** The denial this approves, so it stops being listed as pending. */
  readonly decisionId?: number;
  /** The agent already knows (approved at its own prompt). */
  readonly notified?: boolean;
}

/** Sessions, policy decisions and approvals of a project (see `database` in the config). */
export class Store {
  private readonly db: Database;

  private constructor(db: Database) {
    this.db = db;
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run(SCHEMA);
    this.migrate();
  }

  /** Adds columns introduced after the first database version. */
  private migrate(): void {
    // Default denials recorded before `source = 'default'` existed: they are
    // approvable, so they must show up as pending.
    this.db
      .query(
        "UPDATE decisions SET source = 'default' WHERE source = 'policy' AND decision = 'deny' AND reason = ?",
      )
      .run(NO_RULE_REASON);

    const approvalColumns = this.db
      .query<{ name: string }, []>('PRAGMA table_info(approvals)')
      .all();

    if (!approvalColumns.some((column) => column.name === 'decision_id')) {
      this.db.run('ALTER TABLE approvals ADD COLUMN decision_id INTEGER');
    }
    if (!approvalColumns.some((column) => column.name === 'category')) {
      this.db.run(
        "ALTER TABLE approvals ADD COLUMN category TEXT NOT NULL DEFAULT 'execution'",
      );
    }

    const sessionColumns = this.db
      .query<{ name: string }, []>('PRAGMA table_info(sessions)')
      .all();
    const names = new Set(sessionColumns.map((column) => column.name));
    if (!names.has('executable')) {
      this.db.run('ALTER TABLE sessions ADD COLUMN executable TEXT');
    }
    if (!names.has('arguments')) {
      this.db.run('ALTER TABLE sessions ADD COLUMN arguments TEXT');
    }
    for (const column of ['cwd', 'prompt', 'finished_at', 'outcome', 'agent']) {
      if (!names.has(column)) {
        this.db.run(`ALTER TABLE sessions ADD COLUMN ${column} TEXT`);
      }
    }

    const decisionColumns = new Set(
      this.db
        .query<{ name: string }, []>('PRAGMA table_info(decisions)')
        .all()
        .map((column) => column.name),
    );
    if (!decisionColumns.has('attempts')) {
      this.db.run(
        'ALTER TABLE decisions ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1',
      );
    }
    if (!decisionColumns.has('last_ts')) {
      this.db.run('ALTER TABLE decisions ADD COLUMN last_ts TEXT');
    }
    if (!decisionColumns.has('dismissed_at')) {
      this.db.run('ALTER TABLE decisions ADD COLUMN dismissed_at TEXT');
    }
    if (!decisionColumns.has('category')) {
      this.db.run(
        "ALTER TABLE decisions ADD COLUMN category TEXT NOT NULL DEFAULT 'execution'",
      );
    }
    this.mergeRepeatedDenials();
  }

  /**
   * Denials recorded once per attempt before `attempts` existed: each pending
   * (workspace, session, command) becomes its latest row, with the attempts
   * summed. Every attempt is still in the log.
   */
  private mergeRepeatedDenials(): void {
    const pending = this.db
      .query<DecisionRow, []>(
        `SELECT d.* FROM decisions d WHERE ${PENDING_DENIAL} ORDER BY d.id`,
      )
      .all();
    const groups = new Map<string, DecisionRow[]>();
    for (const row of pending) {
      const key = JSON.stringify([row.root, row.session, row.command]);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    const update = this.db.query(
      'UPDATE decisions SET attempts = ?, last_ts = ? WHERE id = ?',
    );
    const remove = this.db.query('DELETE FROM decisions WHERE id = ?');

    this.db.transaction(() => {
      for (const rows of groups.values()) {
        const keep = rows.at(-1);
        if (keep === undefined || rows.length === 1) continue;

        const attempts = rows.reduce((total, row) => total + row.attempts, 0);
        const lastTs = rows
          .map((row) => row.last_ts ?? row.ts)
          .reduce((latest, ts) => (ts > latest ? ts : latest));
        update.run(attempts, lastTs, keep.id);
        for (const row of rows.slice(0, -1)) remove.run(row.id);
      }
    })();
  }

  public static open(path: string): Store {
    ensureDirectory(dirname(path));
    return new Store(new Database(path));
  }

  public static memory(): Store {
    return new Store(new Database(':memory:'));
  }

  public recordSession(session: NewSession): void {
    const { command } = session;
    this.db
      .query(
        `INSERT OR IGNORE INTO sessions
         (id, provider, root, started_at, executable, arguments, cwd, prompt, agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.provider,
        session.root,
        now(),
        command?.executable ?? null,
        command === undefined ? null : JSON.stringify(command.arguments),
        command?.cwd ?? null,
        session.prompt,
        session.agent ?? null,
      );
    // A resumed session recorded before it had an agent name gets it now.
    if (session.agent !== undefined) {
      this.db
        .query('UPDATE sessions SET agent = ? WHERE id = ? AND agent IS NULL')
        .run(session.agent, session.id);
    }
  }

  /** The conversation ended on its own: nothing left to resume. */
  public finishSession(id: string): void {
    this.db
      .query(
        "UPDATE sessions SET finished_at = ?, outcome = 'finished' WHERE id = ?",
      )
      .run(now(), id);
  }

  /**
   * A new session replaces the open ones of the same provider and workspace:
   * they can no longer be resumed. Marked, not deleted, so their decisions
   * and approvals keep their history.
   */
  public abandonOtherSessions(
    provider: string,
    root: string,
    current: string,
  ): void {
    this.db
      .query(
        `UPDATE sessions SET finished_at = ?, outcome = 'abandoned'
         WHERE provider = ? AND root = ? AND id != ? AND finished_at IS NULL`,
      )
      .run(now(), provider, root, current);
  }

  /**
   * The session an agent should continue instead of starting over: the latest
   * one of this provider, workspace and prompt, if it was interrupted or has
   * approvals the agent has not been told about yet.
   */
  public resumableSession(
    provider: string,
    root: string,
    prompt: string,
  ): string | undefined {
    const last = this.db
      .query<
        { id: string; prompt: string | null; finished_at: string | null },
        [string, string]
      >(
        'SELECT id, prompt, finished_at FROM sessions WHERE provider = ? AND root = ? ORDER BY started_at DESC, rowid DESC LIMIT 1',
      )
      .get(provider, root);

    if (last === null || last.prompt !== prompt) return undefined;
    if (last.finished_at === null) return last.id;

    return this.pendingNotices(root, last.id).length > 0 ? last.id : undefined;
  }

  public sessionCommand(id: string): SessionCommand | undefined {
    const row = this.db
      .query<SessionCommandRow, [string]>(
        'SELECT executable, arguments, cwd FROM sessions WHERE id = ?',
      )
      .get(id);
    if (row === null || row.executable === null || row.arguments === null) {
      return undefined;
    }
    if (row.cwd === null) return undefined;

    const argumentsValue: unknown = JSON.parse(row.arguments);
    if (!isStringArray(argumentsValue)) return undefined;
    return {
      executable: row.executable,
      arguments: argumentsValue,
      cwd: row.cwd,
    };
  }

  /** Most recent session of this provider in this workspace. */
  /** The latest session of this provider and root that has not finished. */
  public openSession(provider: string, root: string): string | undefined {
    const row = this.db
      .query<{ id: string }, [string, string]>(
        'SELECT id FROM sessions WHERE provider = ? AND root = ? AND finished_at IS NULL ORDER BY started_at DESC, rowid DESC LIMIT 1',
      )
      .get(provider, root);
    return row?.id;
  }

  public lastSession(provider: string, root: string): string | undefined {
    const row = this.db
      .query<{ id: string }, [string, string]>(
        'SELECT id FROM sessions WHERE provider = ? AND root = ? ORDER BY started_at DESC, rowid DESC LIMIT 1',
      )
      .get(provider, root);
    return row?.id;
  }

  /**
   * Records a decision and returns its id. A command denied again while its
   * denial is still pending (same workspace, session, category and command) is the same
   * request: its row counts one more attempt instead of a new row.
   */
  public recordDecision(record: DecisionRecord): number {
    const ts = now();

    if (
      record.decision === 'deny' &&
      (record.source === 'default' || record.source === 'human')
    ) {
      const pending = this.db
        .query<{ id: number }, [string, string | null, string, string]>(
          `SELECT d.id FROM decisions d
           WHERE d.root = ? AND d.session IS ? AND d.command = ?
             AND d.category = ? AND ${PENDING_DENIAL}
           ORDER BY d.id DESC LIMIT 1`,
        )
        .get(
          record.root,
          record.session ?? null,
          record.command,
          record.category ?? 'execution',
        );

      if (pending !== null) {
        this.db
          .query(
            `UPDATE decisions SET attempts = attempts + 1, last_ts = ?,
               source = ?, reason = ? WHERE id = ?`,
          )
          .run(ts, record.source, record.reason, pending.id);
        return pending.id;
      }
    }

    const inserted = this.db
      .query(
        `INSERT INTO decisions (ts, session, provider, root, command, category, decision, source, scope, reason, last_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ts,
        record.session ?? null,
        record.provider,
        record.root,
        record.command,
        record.category ?? 'execution',
        record.decision,
        record.source,
        record.scope ?? null,
        record.reason,
        ts,
      );
    return Number(inserted.lastInsertRowid);
  }

  /**
   * Denials still waiting for a decision, in one workspace or (without
   * `root`) in all of them: approvable (by the default or a person, not by an
   * explicit deny rule), not approved afterwards, the same command not
   * allowed later (e.g. answered at the prompt the next time), and not from an
   * abandoned session (nobody waits for it).
   */
  public deniedDecisions(root?: string, limit = 50): StoredDecision[] {
    return this.db
      .query<DecisionRow, [string | null, string | null, number]>(
        `SELECT d.* FROM decisions d
         WHERE (? IS NULL OR d.root = ?) AND ${PENDING_DENIAL}
         ORDER BY d.id DESC LIMIT ?`,
      )
      .all(root ?? null, root ?? null, limit)
      .map(toDecision);
  }

  public decision(id: number): StoredDecision | undefined {
    const row = this.db
      .query<DecisionRow, [number]>('SELECT * FROM decisions WHERE id = ?')
      .get(id);
    return row === null ? undefined : toDecision(row);
  }

  /**
   * A pending denial nobody will approve: it stops being pending (screen,
   * waiting notice) but stays recorded. The command is still denied; trying
   * it again is a new request.
   */
  public dismissDecision(id: number): void {
    this.db
      .query('UPDATE decisions SET dismissed_at = ? WHERE id = ?')
      .run(now(), id);
  }

  public saveApproval(approval: NewApproval): void {
    this.db
      .query(
        'INSERT INTO approvals (root, session, pattern, kind, category, created_at, decision_id, notified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        approval.root,
        approval.session ?? null,
        approval.pattern,
        approval.kind,
        approval.category ?? 'execution',
        now(),
        approval.decisionId ?? null,
        approval.notified === true ? now() : null,
      );
  }

  /** Active approvals for this workspace (and session, for `once`). */
  public activeApprovals(
    root: string,
    session?: string,
    category: DecisionCategory = 'execution',
  ): StoredApproval[] {
    return this.db
      .query<ApprovalRow, [string, string, string]>(
        `SELECT * FROM approvals
         WHERE root = ? AND revoked_at IS NULL AND consumed_at IS NULL
           AND (kind = 'workspace' OR session IS NULL OR session = ?)
           AND category = ?
         ORDER BY id`,
      )
      .all(root, session ?? '', category)
      .map(toApproval);
  }

  public consumeApproval(id: number): void {
    this.db
      .query('UPDATE approvals SET consumed_at = ? WHERE id = ?')
      .run(now(), id);
  }

  /** Approvals the agent of `session` has not been told about yet. */
  public pendingNotices(root: string, session: string): StoredApproval[] {
    return this.db
      .query<ApprovalRow, [string, string]>(
        `SELECT * FROM approvals
         WHERE root = ? AND notified_at IS NULL AND revoked_at IS NULL
           AND (session IS NULL OR session = ?)
         ORDER BY id`,
      )
      .all(root, session)
      .map(toApproval);
  }

  public markNotified(ids: readonly number[]): void {
    const update = this.db.query(
      'UPDATE approvals SET notified_at = ? WHERE id = ?',
    );
    const stamp = now();
    for (const id of ids) update.run(stamp, id);
  }

  public close(): void {
    this.db.close();
  }
}

interface DecisionRow {
  id: number;
  ts: string;
  session: string | null;
  provider: string;
  root: string;
  command: string;
  category: DecisionCategory;
  decision: 'allow' | 'deny';
  source: 'policy' | 'default' | 'human' | 'saved';
  scope: ApprovalScope | null;
  reason: string;
  attempts: number;
  last_ts: string | null;
}

interface SessionCommandRow {
  executable: string | null;
  arguments: string | null;
  cwd: string | null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

interface ApprovalRow {
  id: number;
  root: string;
  session: string | null;
  pattern: string;
  kind: 'once' | 'workspace';
  category: DecisionCategory;
  created_at: string;
  decision_id: number | null;
}

function toDecision(row: DecisionRow): StoredDecision {
  return {
    id: row.id,
    ts: row.ts,
    session: row.session ?? undefined,
    provider: row.provider,
    root: row.root,
    command: row.command,
    category: row.category,
    decision: row.decision,
    source: row.source,
    ...(row.scope === null ? {} : { scope: row.scope }),
    reason: row.reason,
    attempts: row.attempts,
    lastTs: row.last_ts ?? row.ts,
  };
}

function toApproval(row: ApprovalRow): StoredApproval {
  return {
    id: row.id,
    root: row.root,
    session: row.session,
    pattern: row.pattern,
    kind: row.kind,
    category: row.category,
    createdAt: row.created_at,
    ...(row.decision_id === null ? {} : { decisionId: row.decision_id }),
  };
}

function now(): string {
  return new Date().toISOString();
}
