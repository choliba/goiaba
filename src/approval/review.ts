import type { Interaction } from '../interaction/index';
import { DEFAULT_LINE_LENGTH } from '../output/constants';
import { MIN_COMMAND_WIDTH } from './constants';
import { parseSelection } from './selection';
import type { Store, StoredDecision } from '../store/index';
import { suggestPattern } from '../policy/index';

const QUIT = 'q';
const NEXT = 'r';
const ALL = 'a';
/** Answer with one key, no Enter; numbers wait for Enter (`1,3,5`, `1-5`). */
const INSTANT_KEYS: readonly string[] = [QUIT, ALL, NEXT];

interface Column {
  readonly title: string;
  readonly width: number;
  readonly align?: 'right';
}

/** Fixed columns; COMANDO takes the rest of the terminal's width. */
const COLUMNS: readonly Column[] = [
  { title: 'Nº', width: 4, align: 'right' },
  { title: 'ID', width: 5 },
  { title: 'SEL', width: 3 },
  { title: 'SESSÃO', width: 8 },
  { title: 'HORÁRIO', width: 14 },
];
const GAP = '  ';
const MARGIN = '  ';

/** Below the table: how to select, then how to go on or leave. */
const OPTIONS_HELP = [
  'Opções:',
  'número',
  '[1 ou 3 ou 4]',
  '[enter]',
  '',
  'números separados por vírgula',
  '[1,3,4,2 ou 3,2]',
  '[enter]',
  '',
  'range de números',
  '[1-5 ou 2-4]',
  '[enter]',
  '',
  '[a] marca/desmarca todos',
  '',
  '[r] avança',
  '',
  '[q] sair sem salvar',
].join('\n');

/** After `r`: how the selected commands are approved, or dismissed. */
const KIND_HELP = [
  'Aprovar como:',
  '[q] cancelar  (sair sem salvar)',
  '[u] uma vez (comando exato)',
  '[w] sempre neste workspace (padrão do comando)',
  '[d] descartar (não aprova; some da lista)',
].join('\n');

/**
 * Lists commands the execution gate denied and lets you select and approve
 * them, in the style of `git add -i`. Reads and writes only through `output`,
 * so the running agent (Ctrl+A) and `bun run approvals` share one terminal
 * input instead of competing for it.
 */
export class ApprovalReview {
  public constructor(
    private readonly store: Store,
    private readonly output: Interaction,
    /** The narrowest the COMMAND column gets; `MIN_COMMAND_WIDTH` by default. */
    private readonly minCommandWidth = MIN_COMMAND_WIDTH,
  ) {}

  /** Main loop: numbers toggle, `a` all, `r` next (approve as u/w), `q` quits. */
  public async run(root: string | undefined): Promise<void> {
    let denied = this.pendingDenials(root);

    if (denied.length === 0) {
      this.output.write(
        root === undefined
          ? 'Nenhum comando negado.'
          : `Nenhum comando negado em ${root}.`,
      );
      return;
    }

    const selected = new Set<number>();

    for (;;) {
      this.renderTable(denied, selected);
      const answer = await this.prompt('\nUpdate>> ');

      if (answer === undefined || answer === QUIT) {
        this.output.write('Saindo sem alterações.');
        return;
      }

      if (answer === NEXT) {
        await this.processApprovals(denied, selected);
        return;
      }

      // Numbers refer to the table that was shown; then read the store again,
      // so denials of an agent still running show up (Enter just refreshes).
      if (answer !== '') this.toggle(answer, denied, selected);
      denied = this.pendingDenials(root);
      forgetGone(selected, denied);
    }
  }

  /** Pending denials in the order shown and selected: grouped by workspace. */
  private pendingDenials(root: string | undefined): StoredDecision[] {
    return [...byWorkspace(this.store.deniedDecisions(root)).values()].flat();
  }

  /** The answer, trimmed and lower-cased; undefined on Ctrl+D/Ctrl+C. */
  private async prompt(question: string): Promise<string | undefined> {
    this.output.write(question);

    try {
      const answer = await this.output.ask(question, undefined, INSTANT_KEYS);
      return answer.trim().toLowerCase();
    } catch {
      return undefined;
    }
  }

  private toggle(
    answer: string,
    denied: readonly StoredDecision[],
    selected: Set<number>,
  ): void {
    if (answer === ALL) {
      const all = denied.every((decision) => selected.has(decision.id));
      for (const decision of denied) setMarked(selected, decision.id, !all);
      return;
    }

    let indexes: readonly number[];
    try {
      indexes = parseSelection(answer.replaceAll(/\s+/g, ','), denied.length);
    } catch (error) {
      this.output.write(
        `⚠️ ${error instanceof Error ? error.message : String(error)} Use números (ex: 1, 1-3), "a" (todos), "r" (próxima) ou "q" (sair).`,
      );
      return;
    }

    for (const index of indexes) {
      const id = denied.at(index)?.id;
      if (id !== undefined) setMarked(selected, id, !selected.has(id));
    }
  }

  /** The table, numbered in the same order the selection uses. */
  private renderTable(
    denied: readonly StoredDecision[],
    selected: ReadonlySet<number>,
  ): void {
    const width = this.output.lineLength?.() ?? DEFAULT_LINE_LENGTH;
    const commandWidth = Math.max(
      this.minCommandWidth,
      width - fixedWidth() - 1,
    );
    // One block per workspace; numbers go on across blocks, as selected.
    let number = 0;

    for (const [workspace, decisions] of byWorkspace(denied)) {
      this.output.write('');
      this.output.write(`workspace: ${workspace}`);
      this.output.write('─'.repeat(Math.max(0, width - 1)));
      this.output.write(
        line(
          COLUMNS.map((column) => column.title),
          'COMANDO',
        ),
      );
      this.output.write(
        line(
          COLUMNS.map((column) => '─'.repeat(column.width)),
          '─'.repeat(commandWidth),
        ),
      );

      for (const decision of decisions) {
        number += 1;
        this.output.write(
          line(
            cells(number, decision, selected.has(decision.id)),
            summarize(subjectOf(decision), commandWidth, decision.attempts),
          ),
        );
      }
    }

    this.output.write(`\n${OPTIONS_HELP}`);
  }

  /**
   * "Uma vez" approves the exact command; "workspace" approves its pattern
   * (`mkdir -p src/x` → `mkdir *`) for every future run.
   */
  private async processApprovals(
    denied: readonly StoredDecision[],
    selected: ReadonlySet<number>,
  ): Promise<void> {
    const toApprove = denied.filter((decision) => selected.has(decision.id));

    if (toApprove.length === 0) {
      this.output.write('Nenhum comando selecionado para aprovação.');
      return;
    }

    // The table cuts long commands; what is approved is shown in full.
    this.showInFull(toApprove);
    const kind = await this.askKind();
    if (kind === undefined) {
      this.output.write('Saindo sem alterações.');
      return;
    }

    if (kind === 'dismiss') {
      for (const decision of toApprove) {
        this.store.dismissDecision(decision.id);
        this.output.write(
          `✖ Descartado (#${String(decision.id)}): ${firstLine(subjectOf(decision))}`,
        );
      }
      this.output.write(
        '\nPedidos descartados: ninguém vai esperar por eles. Se o agente tentar de novo, vira um pedido novo.',
      );
      return;
    }

    for (const decision of toApprove) {
      // A destination is approved as is; a command, by its pattern.
      const pattern =
        kind === 'workspace' && decision.category === 'execution'
          ? suggestPattern(decision.command)
          : decision.command;
      this.store.saveApproval({
        root: decision.root,
        pattern,
        kind,
        category: decision.category,
        session: decision.session,
        decisionId: decision.id,
      });
      this.output.write(
        `✔ Aprovado (#${String(decision.id)}): ${firstLine(
          decision.category === 'network' ? `rede ${pattern}` : pattern,
        )}`,
      );
    }

    this.output.write(
      '\nAprovações salvas. O agente em execução continua sozinho; se ele não estiver rodando, rode-o de novo e ele retoma de onde parou.',
    );
  }

  private showInFull(decisions: readonly StoredDecision[]): void {
    this.output.write('\nSelecionados:');

    for (const decision of decisions) {
      const [first = '', ...rest] = subjectOf(decision).split('\n');
      this.output.write(`\n  #${String(decision.id)}  ${first}`);
      for (const next of rest) this.output.write(`        ${next}`);
    }
  }

  private async askKind(): Promise<
    'once' | 'workspace' | 'dismiss' | undefined
  > {
    this.output.write(`\n${KIND_HELP}`);

    let answer: string;
    try {
      answer =
        this.output.choose === undefined
          ? (await this.output.ask('[u/w/d/q]: ')).trim().toLowerCase()
          : await this.output.choose(['u', 'w', 'd', 'q']);
    } catch {
      return undefined;
    }

    if (answer === 'w') return 'workspace';
    if (answer === 'd') return 'dismiss';
    if (answer === 'u' || answer === '') return 'once';
    return undefined;
  }
}

/** Drops marks of denials no longer pending (e.g. answered at the prompt). */
function forgetGone(
  selected: Set<number>,
  denied: readonly StoredDecision[],
): void {
  const pending = new Set(denied.map((decision) => decision.id));
  for (const id of selected) {
    if (!pending.has(id)) selected.delete(id);
  }
}

function setMarked(selected: Set<number>, id: number, marked: boolean): void {
  if (marked) {
    selected.add(id);
    return;
  }

  selected.delete(id);
}

function cells(
  number: number,
  decision: StoredDecision,
  marked: boolean,
): string[] {
  return [
    `${String(number)}:`,
    `#${String(decision.id)}`,
    marked ? '[x]' : '[ ]',
    (decision.session ?? 'N/A').slice(0, 8),
    // The last time it was asked: repeats count on the same row.
    decision.lastTs.replace('T', ' ').slice(5, 19),
  ];
}

/** A row: each fixed cell padded to its column, then the command. */
function line(values: readonly string[], command: string): string {
  const fixed = COLUMNS.map((column, index) => {
    const value = fit(values[index] ?? '', column.width);
    return column.align === 'right'
      ? value.padStart(column.width)
      : value.padEnd(column.width);
  });

  return `${MARGIN}${[...fixed, command].join(GAP)}`;
}

function fixedWidth(): number {
  const columns = COLUMNS.reduce((total, column) => total + column.width, 0);
  return MARGIN.length + columns + GAP.length * COLUMNS.length;
}

/**
 * The command in one line of at most `width` characters: the first line,
 * cut with `…` if needed, keeping how many lines a heredoc has.
 */
function summarize(command: string, width: number, attempts = 1): string {
  const [first = '', ...rest] = command.split('\n');
  const lines = rest.length === 0 ? '' : `  (+${String(rest.length)} linhas)`;
  const repeated = attempts > 1 ? `  ×${String(attempts)}` : '';
  const suffix = `${lines}${repeated}`;

  return `${fit(first.trim(), width - suffix.length)}${suffix}`;
}

/** `text`, cut to `width` characters with a trailing `…`. */
function fit(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function byWorkspace(
  decisions: readonly StoredDecision[],
): Map<string, StoredDecision[]> {
  const groups = new Map<string, StoredDecision[]>();

  for (const decision of decisions) {
    const group = groups.get(decision.root) ?? [];
    group.push(decision);
    groups.set(decision.root, group);
  }

  return groups;
}

/** Heredocs and scripts span many lines; the first one says what it is. */
/** What was denied, as listed: the command, or `rede host:port`. */
function subjectOf(decision: StoredDecision): string {
  return decision.category === 'network'
    ? `rede ${decision.command}`
    : decision.command;
}

function firstLine(command: string): string {
  const [first = '', ...rest] = command.split('\n');
  return rest.length === 0
    ? first
    : `${first.trim()}  (+${String(rest.length)} linhas)`;
}
