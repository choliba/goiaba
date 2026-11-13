/**
 * One agent of the round as the create form holds it, and what the form
 * makes of it: the declared actor, its criteria, what is missing, a pasted
 * actor read back into the form, and its criteria said in plain words.
 * Pure: the page and its editor hold the state.
 */

import type { AgentPolicy } from '../../../../../src/policy/policy.interface';
import { OLLAMA_CLIS } from '../../../../../src/providers/constants';
import { GOIABA_TOOLS } from '../../../../../src/providers/tools';
import type {
  DeclaredActor,
  DeclaredOptionValue,
  FileCriterion,
  LimitCriterion,
  RoundCriterion,
} from '../../../../../src/rounds/types';
import { PROJECT_TOOLS, projectTool } from '../../known-tools';

/** The providers the form offers, each with a model to start from. */
export const PROVIDERS = {
  ollama: { label: 'Ollama, um modelo nesta máquina', model: 'qwen3.5:4b' },
  claude: { label: 'Claude', model: 'claude-sonnet-5-5' },
  codex: { label: 'Codex', model: 'gpt-5.6-terra' },
  cursor: { label: 'Cursor', model: 'auto' },
} as const;

export type ProviderName = keyof typeof PROVIDERS;

export const isProvider = (value: string): value is ProviderName =>
  value in PROVIDERS;

/** A CLI that can drive a model on Ollama. */
export type OllamaCli = (typeof OLLAMA_CLIS)[number];

export const isOllamaCli = (value: string): value is OllamaCli =>
  (OLLAMA_CLIS as readonly string[]).includes(value);

/** How each CLI is called in the form. */
export const CLI_LABELS: Readonly<Record<OllamaCli, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

/** A command's permission in the policy: allowed, or not allowed. */
export type Permission = 'allow' | 'deny';

/** The CLI's capabilities, in the words the form uses. */
export const CLI_TOOL_LABELS: Readonly<
  Record<(typeof GOIABA_TOOLS)[number], string>
> = {
  file_read: 'ler arquivos',
  file_write: 'criar arquivos',
  file_edit: 'editar arquivos',
  file_list: 'listar pastas',
  file_search: 'procurar nos arquivos',
  web_fetch: 'abrir páginas (a do CLI)',
  web_search: 'buscar na web (a do CLI)',
  shell: 'rodar comandos',
};

/** Every tool name the form can offer: the CLI's, then the project's. */
export const OFFERED_TOOLS: readonly string[] = [
  ...GOIABA_TOOLS,
  ...PROJECT_TOOLS.map((tool) => tool.name),
];

/** What the agent may do in its workspace. */
export type Access = 'write' | 'read';

export const isAccess = (value: string): value is Access =>
  value === 'write' || value === 'read';

/** What a workspace keeps of the host's CLI state (`hostState`). */
export const HOST_STATES = {
  none: 'nada: ele não vê nada desta máquina',
  login: 'só o login do CLI',
  share: 'o estado do CLI nesta máquina (sessões, histórico)',
} as const;

export type HostState = keyof typeof HOST_STATES;

export const isHostState = (value: string): value is HostState =>
  value in HOST_STATES;

/** The sandbox a workspace runs in (`type`). */
export const SANDBOXES = {
  bubblewrap: 'bubblewrap: leve, usa os programas desta máquina',
  docker: 'docker: um contêiner, com a imagem que você escolher',
} as const;

export type Sandbox = keyof typeof SANDBOXES;

export const isSandbox = (value: string): value is Sandbox =>
  value in SANDBOXES;

/** What `ollama ps` usually shows a model loaded with, in tokens. */
export const DEFAULT_CONTEXT_WINDOW = '32768';

/** A whole positive number typed in a field; `undefined` when it is not one. */
export function wholeNumber(value: string): number | undefined {
  const number = Number(value.replaceAll('_', '').trim());
  return value.trim() !== '' && Number.isInteger(number) && number > 0
    ? number
    : undefined;
}

/** The lines of a text area, trimmed, without blank ones at either end. */
export function lines(text: string): string[] {
  const all = text.split('\n').map((line) => line.trim());
  const first = all.findIndex((line) => line.length > 0);
  const last = all.findLastIndex((line) => line.length > 0);
  // Blank lines between passages stay: they separate parts of the prompt.
  return first === -1 ? [] : all.slice(first, last + 1);
}

// --- criteria ---

/** What a file criterion checks, in the words the form uses. */
export const CHECKS = {
  created: { label: 'ter sido criado', criterion: { created: true } },
  exists: { label: 'existir', criterion: { exists: true } },
  changed: { label: 'ter mudado', criterion: { changed: true } },
  unchanged: { label: 'continuar igual', criterion: { changed: false } },
  absent: { label: 'não existir', criterion: { exists: false } },
} as const satisfies Record<
  string,
  { readonly label: string; readonly criterion: Partial<FileCriterion> }
>;

export type Check = keyof typeof CHECKS;

export const isCheck = (value: string): value is Check => value in CHECKS;

/** A file assertion as the form holds it: which file, what of it, what it contains. */
export interface FileFields {
  readonly name: string;
  readonly check: Check;
  /** Passages it must contain, separated by commas. */
  readonly contains: string;
}

/** What a condition looks at, at the start of the step. */
export const CONDITIONS = {
  absent: 'ainda não existe',
  exists: 'já existe',
  contains: 'contém o trecho',
} as const;

export type ConditionCheck = keyof typeof CONDITIONS;

export const isConditionCheck = (value: string): value is ConditionCheck =>
  value in CONDITIONS;

/** One criterion as the form holds it: a file assertion, or a conditional. */
export type CriterionRow =
  | { readonly key: number; readonly kind: 'file'; readonly file: FileFields }
  | {
      readonly key: number;
      readonly kind: 'if';
      /** The condition: a file, at the start of the step. */
      readonly when: {
        readonly name: string;
        readonly check: ConditionCheck;
        readonly contains: string;
      };
      /** What is checked when the condition holds (`check`). */
      readonly checkFile: FileFields;
      /** Whether there is an `else`, and what it checks. */
      readonly hasElse: boolean;
      readonly elseFile: FileFields;
    };

export const emptyFile = (): FileFields => ({
  name: '',
  check: 'created',
  contains: '',
});

/** Passages separated by commas, trimmed, empty ones left out. */
export const passages = (text: string): string[] =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

/** A file assertion as the declaration writes it. */
const fileCriterion = (file: FileFields): RoundCriterion => {
  const contains = file.check === 'absent' ? [] : passages(file.contains);
  return {
    file: {
      name: file.name.trim(),
      ...CHECKS[file.check].criterion,
      ...(contains.length === 0 ? {} : { contains }),
    },
  };
};

/** A criterion row as the declaration writes it. */
function criterionOf(row: CriterionRow): RoundCriterion {
  if (row.kind === 'file') return fileCriterion(row.file);
  const when = row.when;
  return {
    if: {
      name: when.name.trim(),
      ...(when.check === 'exists' ? { exists: true } : {}),
      ...(when.check === 'absent' ? { exists: false } : {}),
      ...(when.check === 'contains'
        ? { contains: passages(when.contains) }
        : {}),
    },
    check: [fileCriterion(row.checkFile)],
    ...(row.hasElse ? { else: [fileCriterion(row.elseFile)] } : {}),
  };
}

/** Whether a file assertion has no file yet. */
const unnamed = (file: FileFields): boolean => file.name.trim().length === 0;

/** What is missing in a criterion row, in plain words. */
export function rowProblems(row: CriterionRow): string[] {
  if (row.kind === 'file') {
    return unnamed(row.file) ? ['diga de qual arquivo é cada conferência'] : [];
  }
  return [
    ...(row.when.name.trim().length === 0
      ? ['diga qual arquivo a condição olha']
      : []),
    ...(row.when.check === 'contains' &&
    passages(row.when.contains).length === 0
      ? ['diga qual trecho a condição procura']
      : []),
    ...(unnamed(row.checkFile) || (row.hasElse && unnamed(row.elseFile))
      ? ['diga o arquivo de cada lado da condição']
      : []),
  ];
}

/** The limits a form fills: time, new tokens, cost; empty is no limit. */
export interface LimitFields {
  readonly time: string;
  readonly tokens: string;
  readonly cost: string;
}

export const noLimits: LimitFields = { time: '', tokens: '', cost: '' };

/** A duration a limit takes: `90s`, `2min`. */
const DURATION = /^\d+(\.\d+)?\s*(ms|s|min|h)$/;

/** A cost in USD: `0.05`. */
const COST = /^\d+(\.\d+)?$/;

/** The limit as the declaration writes it; `undefined` without any. */
export function limitOf(fields: LimitFields): LimitCriterion | undefined {
  const limit = {
    ...(fields.time.trim().length === 0 ? {} : { time: fields.time.trim() }),
    ...(fields.tokens.trim().length === 0
      ? {}
      : { tokens: Number(fields.tokens.trim()) }),
    ...(fields.cost.trim().length === 0 ? {} : { cost: fields.cost.trim() }),
  };
  return Object.keys(limit).length === 0 ? undefined : limit;
}

/** What is wrong in the limits, in plain words. */
export function limitProblems(fields: LimitFields): string[] {
  return [
    ...(fields.time.trim().length > 0 && !DURATION.test(fields.time.trim())
      ? ['escreva o tempo como 90s ou 2min']
      : []),
    ...(fields.tokens.trim().length > 0 && !/^\d+$/.test(fields.tokens.trim())
      ? ['escreva os tokens como um número inteiro']
      : []),
    ...(fields.cost.trim().length > 0 && !COST.test(fields.cost.trim())
      ? ['escreva o custo em dólares, como 0.05']
      : []),
  ];
}

/** Limits read back from a declaration, merged into the form's fields. */
export const limitFields = (limit: LimitCriterion): LimitFields => ({
  time: limit.time ?? '',
  tokens: limit.tokens === undefined ? '' : String(limit.tokens),
  cost: limit.cost ?? '',
});

// --- the agent ---

/** One agent as the form holds it. */
export interface AgentForm {
  readonly key: number;
  readonly name: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly cli: OllamaCli;
  readonly contextWindow: string;
  readonly think: boolean;
  /** The CLI's program, when not the usual one (`executable`); empty for it. */
  readonly executable: string;
  /** Ollama only: the server, when not the local one (`baseUrl`). */
  readonly baseUrl: string;
  /** Ollama with Codex only: the share of the memory that compacts (`compactAt`). */
  readonly compactAt: string;
  /** Claude and Codex: the rules go with the first message only (`rulesOnce`). */
  readonly rulesOnce: boolean;
  /** Codex only: the user's Codex login reaches the CLI (`login`). */
  readonly login: boolean;
  /** Options the form has no field for, kept as they came. */
  readonly otherOptions: Readonly<Record<string, DeclaredOptionValue>>;
  /** Whether it sees only the tools chosen (`tools`), not all the CLI's. */
  readonly chooseTools: boolean;
  readonly tools: ReadonlySet<string>;
  readonly sandbox: Sandbox;
  readonly image: string;
  readonly hostState: HostState;
  /** Paths it may write besides the round's folder, one per line (`writable`). */
  readonly writable: string;
  /** Ports of the sandbox reached from this machine, by commas (`ports`). */
  readonly ports: string;
  /** Where the workspaces' homes are kept (`homes`); empty for the config's. */
  readonly homes: string;
  readonly access: Access;
  /** Each command's permission: allowed or not; unmarked, the default. */
  readonly decided: ReadonlyMap<string, Permission>;
  /** Commands typed by hand, one per line: allowed, and not allowed. */
  readonly moreAllowed: string;
  readonly moreDenied: string;
  readonly hosts: string;
  /** Hosts denied even when an allowed pattern covers them (`deny.network`). */
  readonly deniedHosts: string;
  /** The project's tools the policy allows or denies (`tools`, by name). */
  readonly toolDecided: ReadonlyMap<string, Permission>;
  readonly criteria: readonly CriterionRow[];
  readonly limits: LimitFields;
}

/** A new agent, as the form starts it. */
export const newAgent = (key: number, name: string): AgentForm => ({
  key,
  name,
  provider: 'ollama',
  model: PROVIDERS.ollama.model,
  cli: OLLAMA_CLIS[0],
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  think: false,
  executable: '',
  baseUrl: '',
  compactAt: '',
  rulesOnce: false,
  login: true,
  otherOptions: {},
  chooseTools: false,
  tools: new Set(),
  sandbox: 'bubblewrap',
  image: 'FROM busybox:latest',
  hostState: 'none',
  writable: '',
  ports: '',
  homes: '',
  access: 'write',
  decided: new Map(),
  moreAllowed: '',
  moreDenied: '',
  hosts: '',
  deniedHosts: '',
  toolDecided: new Map(),
  criteria: [],
  limits: noLimits,
});

/** Only Claude Code takes `tools` (ClaudeProvider, or Ollama with cli: claude). */
export const takesTools = (agent: AgentForm): boolean =>
  agent.provider === 'claude' ||
  (agent.provider === 'ollama' && agent.cli === 'claude');

/** The tools it sees, when chosen; `undefined` for all the CLI's. */
export const chosenTools = (agent: AgentForm): string[] | undefined =>
  takesTools(agent) && agent.chooseTools
    ? OFFERED_TOOLS.filter((tool) => agent.tools.has(tool))
    : undefined;

/** Its policy: what is not allowed here is denied, nobody is asked. */
export function policyOf(
  agent: AgentForm,
  offered: readonly string[],
): AgentPolicy {
  // The marked ones in the order offered, then the typed ones; each once.
  const marked = (permission: Permission): string[] => [
    ...new Set([
      ...offered.filter((command) => agent.decided.get(command) === permission),
      ...lines(permission === 'allow' ? agent.moreAllowed : agent.moreDenied),
    ]),
  ];
  const allowedCommands = marked('allow');
  const deniedCommands = marked('deny');
  const allowedHosts = lines(agent.hosts);
  const deniedHosts = lines(agent.deniedHosts);
  const toolsWith = (permission: Permission): string[] =>
    PROJECT_TOOLS.map((tool) => tool.name).filter(
      (tool) => agent.toolDecided.get(tool) === permission,
    );
  const allowedTools = toolsWith('allow');
  const deniedTools = toolsWith('deny');
  return {
    default: 'deny',
    allow: {
      filesystem: [
        {
          operations: agent.access === 'write' ? ['*'] : ['read'],
          paths: ['/workspace/**'],
        },
      ],
      ...(allowedCommands.length === 0
        ? {}
        : { execution: [{ operations: ['run'], commands: allowedCommands }] }),
      ...(allowedHosts.length === 0
        ? {}
        : { network: [{ operations: ['*'], hosts: allowedHosts }] }),
      ...(allowedTools.length === 0
        ? {}
        : { tools: [{ operations: ['call'], tools: allowedTools }] }),
    },
    // Not allowed even when an allowed pattern covers it (git * but not
    // git push *; every site but *.openai.com).
    ...(deniedCommands.length === 0 &&
    deniedTools.length === 0 &&
    deniedHosts.length === 0
      ? {}
      : {
          deny: {
            ...(deniedCommands.length === 0
              ? {}
              : {
                  execution: [
                    { operations: ['run'], commands: deniedCommands },
                  ],
                }),
            ...(deniedHosts.length === 0
              ? {}
              : { network: [{ operations: ['*'], hosts: deniedHosts }] }),
            ...(deniedTools.length === 0
              ? {}
              : { tools: [{ operations: ['call'], tools: deniedTools }] }),
          },
        }),
  };
}

/** Which of the form's own options each provider takes. */
const takesBaseUrl = (agent: AgentForm): boolean => agent.provider === 'ollama';
const takesCompactAt = (agent: AgentForm): boolean =>
  agent.provider === 'ollama' && agent.cli === 'codex';
const takesRulesOnce = (agent: AgentForm): boolean =>
  agent.provider === 'claude' || agent.provider === 'codex';
const takesLogin = (agent: AgentForm): boolean => agent.provider === 'codex';
export const optionsTaken = {
  baseUrl: takesBaseUrl,
  compactAt: takesCompactAt,
  rulesOnce: takesRulesOnce,
  login: takesLogin,
} as const;

/** A share between 0 and 1, like 0.8; `undefined` when it is not one. */
export function share(value: string): number | undefined {
  const number = Number(value.trim());
  return value.trim() !== '' && number > 0 && number <= 1 ? number : undefined;
}

/** Ports typed by commas or spaces. */
export const portsOf = (text: string): string[] =>
  text.split(/[\s,]+/).filter((part) => part.length > 0);

/** The options beyond the declaration's own fields, as the provider takes them. */
function optionsOf(
  agent: AgentForm,
): Readonly<Record<string, DeclaredOptionValue>> | undefined {
  const compactAt = share(agent.compactAt);
  const options = {
    ...(agent.executable.trim().length === 0
      ? {}
      : { executable: agent.executable.trim() }),
    ...(takesBaseUrl(agent) && agent.baseUrl.trim().length > 0
      ? { baseUrl: agent.baseUrl.trim() }
      : {}),
    ...(takesCompactAt(agent) && compactAt !== undefined ? { compactAt } : {}),
    ...(takesRulesOnce(agent) && agent.rulesOnce ? { rulesOnce: true } : {}),
    ...(takesLogin(agent) && !agent.login ? { login: false } : {}),
    ...agent.otherOptions,
  };
  return Object.keys(options).length === 0 ? undefined : options;
}

/** The provider as the declaration writes it. */
function providerOf(agent: AgentForm): DeclaredActor['provider'] {
  const tools = chosenTools(agent);
  const options = optionsOf(agent);
  const chosen = {
    ...(tools === undefined ? {} : { tools }),
    ...(options === undefined ? {} : { options }),
  };
  const contextWindow = wholeNumber(agent.contextWindow);
  return agent.provider === 'ollama'
    ? {
        name: agent.provider,
        cli: agent.cli,
        model: agent.model,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        // Turning the thinking off is Claude Code's option only.
        ...(agent.cli === 'claude' && !agent.think ? { think: false } : {}),
        ...chosen,
      }
    : { name: agent.provider, cli: null, model: agent.model, ...chosen };
}

/** The agent as the declaration writes it, working in the round's folder. */
export const actorOf = (
  agent: AgentForm,
  id: string,
  offered: readonly string[],
): DeclaredActor => ({
  provider: providerOf(agent),
  // One folder for the round: written as roundDir(id).
  workspace: {
    type: agent.sandbox,
    image: agent.sandbox === 'docker' ? agent.image.trim() : null,
    root: id,
    hostState: agent.hostState,
    ...(lines(agent.writable).length === 0
      ? {}
      : { writable: lines(agent.writable) }),
    ...(portsOf(agent.ports).length === 0
      ? {}
      : { ports: portsOf(agent.ports).map(Number) }),
    ...(agent.homes.trim().length === 0 ? {} : { homes: agent.homes.trim() }),
  },
  policy: policyOf(agent, offered),
  readOnly: agent.access === 'read',
});

/** Its criteria as the declaration writes them: the complete rows, then the limit. */
export function criteriaOf(agent: AgentForm): RoundCriterion[] {
  const limit = limitOf(agent.limits);
  return [
    ...agent.criteria
      .filter((row) => rowProblems(row).length === 0)
      .map(criterionOf),
    ...(limit === undefined ? [] : [{ limit }]),
  ];
}

/** What is missing or wrong in this agent, in plain words. */
export function agentProblems(agent: AgentForm): string[] {
  const tools = chosenTools(agent) ?? [];
  return [
    ...(agent.name.trim().length === 0 ? ['dê um nome a ele'] : []),
    ...(agent.model.trim().length === 0 ? ['diga qual modelo ele usa'] : []),
    ...(agent.sandbox === 'docker' && agent.image.trim().length === 0
      ? ['o docker precisa de uma imagem']
      : []),
    ...(agent.provider === 'ollama' &&
    agent.contextWindow.trim() !== '' &&
    wholeNumber(agent.contextWindow) === undefined
      ? ['a memória do modelo é um número inteiro de tokens, como 32768']
      : []),
    ...(takesCompactAt(agent) &&
    agent.compactAt.trim() !== '' &&
    share(agent.compactAt) === undefined
      ? ['o ponto de resumir a conversa é uma fração entre 0 e 1, como 0.8']
      : []),
    ...(portsOf(agent.ports).some((port) => wholeNumber(port) === undefined)
      ? ['as portas são números inteiros, como 5173']
      : []),
    ...tools
      .filter(
        (tool) =>
          projectTool(tool) !== undefined &&
          agent.toolDecided.get(tool) !== 'allow',
      )
      .map(
        (tool) =>
          `ele vê ${tool}, mas não tem permissão para usá-la: libere-a em "O que ele pode fazer"`,
      ),
    ...new Set(agent.criteria.flatMap(rowProblems)),
    ...limitProblems(agent.limits),
  ];
}

// --- reading a declared agent back ---

/**
 * A declared agent read back into the form, with what the form cannot show
 * of it pushed to `warnings` (it is left out).
 */
export function agentFromDeclaration(
  key: number,
  name: string,
  declared: DeclaredActor,
  criteria: readonly RoundCriterion[],
  offered: readonly string[],
  warnings: string[],
): AgentForm {
  const said = (text: string): void => {
    warnings.push(`${name}: ${text}`);
  };
  const base = newAgent(key, name);
  const providerName = declared.provider.name;
  const provider = isProvider(providerName) ? providerName : base.provider;
  if (!isProvider(providerName)) {
    said(`o provider ${providerName} não está no formulário.`);
  }
  const cli =
    declared.provider.cli !== null && isOllamaCli(declared.provider.cli)
      ? declared.provider.cli
      : base.cli;
  const loadedTools = declared.provider.tools;
  if (
    loadedTools !== undefined &&
    providerName !== 'claude' &&
    !(providerName === 'ollama' && declared.provider.cli === 'claude')
  ) {
    said(
      `escolher as ferramentas só vale com o Claude Code; com ${providerName}${declared.provider.cli === null ? '' : ` (cli: ${declared.provider.cli})`} a rodada é recusada. Use o Claude Code ou tire as ferramentas.`,
    );
  }
  const unknownTools = (loadedTools ?? []).filter(
    (tool) => !OFFERED_TOOLS.includes(tool),
  );
  if (unknownTools.length > 0) {
    said(
      `as ferramentas ${unknownTools.join(', ')} não estão no formulário (nem no CLI, nem em agents/tools).`,
    );
  }

  const given = declared.provider.options ?? {};
  const known = new Set([
    'executable',
    'baseUrl',
    'compactAt',
    'rulesOnce',
    'login',
  ]);
  const otherOptions = Object.fromEntries(
    Object.entries(given).filter(([option]) => !known.has(option)),
  );
  if (Object.keys(otherOptions).length > 0) {
    said(
      `as opções ${Object.keys(otherOptions).join(', ')} do provider não têm campo no formulário: ficam como vieram.`,
    );
  }
  const option = (optionName: string): DeclaredOptionValue | undefined =>
    given[optionName];

  const policy = declared.policy;
  const allowed = (policy?.allow?.execution ?? []).flatMap((r) => r.commands);
  const denied = (policy?.deny?.execution ?? []).flatMap((r) => r.commands);
  const projectToolsIn = (
    group: 'allow' | 'deny',
    permission: Permission,
  ): [string, Permission][] =>
    (policy?.[group]?.tools ?? []).flatMap((rule) =>
      rule.tools.flatMap((tool): [string, Permission][] => {
        if (projectTool(tool) !== undefined) return [[tool, permission]];
        said(
          `a permissão da ferramenta ${tool} não está no formulário: só as de agents/tools.`,
        );
        return [];
      }),
    );
  const shown = new Set(['filesystem', 'execution', 'network', 'tools']);
  const hidden = (['allow', 'requireApproval', 'deny'] as const).flatMap(
    (group) =>
      Object.entries(policy?.[group] ?? {})
        .filter(([category, rules]) => {
          if (!Array.isArray(rules) || rules.length === 0) return false;
          if (
            group === 'deny' &&
            (category === 'execution' ||
              category === 'tools' ||
              category === 'network')
          )
            return false;
          return group !== 'allow' || !shown.has(category);
        })
        .map(([category]) => `${group}.${category}`),
  );
  if (hidden.length > 0) {
    said(
      `a política tem regras que o formulário ainda não mostra: ${hidden.join(', ')}.`,
    );
  }

  const fileFields = (file: FileCriterion): FileFields => {
    const check: Check =
      file.created === true
        ? 'created'
        : file.exists === false
          ? 'absent'
          : file.changed === true
            ? 'changed'
            : file.changed === false
              ? 'unchanged'
              : 'exists';
    if (file.matches !== undefined || file.equals !== undefined) {
      said(
        `a conferência de ${file.name} usa matches ou equals, que o formulário ainda não mostra.`,
      );
    }
    return {
      name: file.name,
      check,
      contains: (file.contains ?? []).join(', '),
    };
  };
  const rows: CriterionRow[] = [];
  let limits: LimitCriterion = {};
  criteria.forEach((criterion, index) => {
    const rowKey = index + 1;
    if ('file' in criterion) {
      rows.push({
        key: rowKey,
        kind: 'file',
        file: fileFields(criterion.file),
      });
    } else if ('limit' in criterion) {
      limits = { ...limits, ...criterion.limit };
    } else {
      const [checked] = criterion.check;
      const [otherwise] = criterion.else ?? [];
      if (
        checked === undefined ||
        !('file' in checked) ||
        (otherwise !== undefined && !('file' in otherwise))
      ) {
        said(
          'uma conferência com condição tem lados que o formulário ainda não mostra.',
        );
        return;
      }
      rows.push({
        key: rowKey,
        kind: 'if',
        when: {
          name: criterion.if.name,
          check:
            criterion.if.contains !== undefined
              ? 'contains'
              : criterion.if.exists === false
                ? 'absent'
                : 'exists',
          contains: (criterion.if.contains ?? []).join(', '),
        },
        checkFile: fileFields(checked.file),
        hasElse: otherwise !== undefined,
        elseFile:
          otherwise !== undefined && 'file' in otherwise
            ? fileFields(otherwise.file)
            : emptyFile(),
      });
    }
  });

  return {
    ...base,
    provider,
    model: declared.provider.model ?? '',
    cli,
    contextWindow:
      declared.provider.contextWindow === undefined
        ? ''
        : String(declared.provider.contextWindow),
    think: declared.provider.think !== false,
    executable:
      typeof option('executable') === 'string'
        ? String(option('executable'))
        : '',
    baseUrl:
      typeof option('baseUrl') === 'string' ? String(option('baseUrl')) : '',
    compactAt:
      typeof option('compactAt') === 'number'
        ? String(option('compactAt'))
        : '',
    rulesOnce: option('rulesOnce') === true,
    login: option('login') !== false,
    otherOptions,
    chooseTools: loadedTools !== undefined,
    tools: new Set(
      (loadedTools ?? []).filter((tool) => OFFERED_TOOLS.includes(tool)),
    ),
    sandbox: declared.workspace.type,
    image: declared.workspace.image ?? base.image,
    hostState: declared.workspace.hostState ?? 'login',
    writable: (declared.workspace.writable ?? []).join('\n'),
    ports: (declared.workspace.ports ?? []).join(', '),
    homes: declared.workspace.homes ?? '',
    access: declared.readOnly ? 'read' : 'write',
    decided: new Map([
      ...allowed
        .filter((command) => offered.includes(command))
        .map((command): [string, Permission] => [command, 'allow']),
      ...denied
        .filter((command) => offered.includes(command))
        .map((command): [string, Permission] => [command, 'deny']),
    ]),
    moreAllowed: allowed.filter((c) => !offered.includes(c)).join('\n'),
    moreDenied: denied.filter((c) => !offered.includes(c)).join('\n'),
    hosts: (policy?.allow?.network ?? [])
      .flatMap((rule) => rule.hosts)
      .join('\n'),
    deniedHosts: (policy?.deny?.network ?? [])
      .flatMap((rule) => rule.hosts)
      .join('\n'),
    toolDecided: new Map([
      ...projectToolsIn('allow', 'allow'),
      ...projectToolsIn('deny', 'deny'),
    ]),
    criteria: rows,
    limits: limitFields(limits),
  };
}

// --- in plain words ---

/** A passage in words: an answer asked before the round is said as such. */
const passage = (item: string): string => {
  const whole = /^\{\{input:([^}]+)\}\}$/.exec(item);
  return whole?.[1] === undefined
    ? `“${item.replace(/\{\{input:([^}]+)\}\}/g, '‹resposta de $1›')}”`
    : `a resposta de ${whole[1]}`;
};

const quoted = (items: readonly string[]): string =>
  items.map(passage).join(', ');

/** `pesquisa.txt deve ter sido criado e conter “x”`. */
function fileInWords(file: FileFields): string {
  const contains = file.check === 'absent' ? [] : passages(file.contains);
  return `o arquivo ${file.name.trim()} deve ${CHECKS[file.check].label}${
    contains.length === 0 ? '' : ` e conter ${quoted(contains)}`
  }`;
}

/**
 * What a criterion asks of the agent, in a sentence: the same reading the
 * rounds make of it, so whoever fills the form sees what will be checked.
 */
export function rowInWords(row: CriterionRow): string {
  if (row.kind === 'file') return `No fim do passo, ${fileInWords(row.file)}.`;
  const name = row.when.name.trim();
  const condition =
    row.when.check === 'contains'
      ? `o arquivo ${name} contém ${quoted(passages(row.when.contains))}`
      : `o arquivo ${name} ${CONDITIONS[row.when.check]}`;
  return `Se, quando ele começa, ${condition}: no fim do passo, ${fileInWords(row.checkFile)}.${
    row.hasElse
      ? ` Se não: ${fileInWords(row.elseFile)}.`
      : ' Se não, nada é cobrado dele.'
  }`;
}

/** A limit in a sentence: `Pode levar até 2min e gastar até 5000 tokens novos.` */
export function limitInWords(fields: LimitFields): string | undefined {
  const parts = [
    ...(fields.time.trim().length === 0
      ? []
      : [`levar até ${fields.time.trim()}`]),
    ...(fields.tokens.trim().length === 0
      ? []
      : [`gastar até ${fields.tokens.trim()} tokens novos`]),
    ...(fields.cost.trim().length === 0
      ? []
      : [`custar até US$ ${fields.cost.trim()}`]),
  ];
  if (parts.length === 0) return undefined;
  const last = parts.pop() ?? '';
  return `Pode ${parts.length === 0 ? last : `${parts.join(', ')} e ${last}`}.`;
}
