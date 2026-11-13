/**
 * A round's declaration back from data (`RoundDeclaration`, captured by
 * `captureDeclaration` when it ran) to the source of
 * `rounds/definitions/<id>.ts`, and one actor back to an agent of `agents/`.
 * A piece of the pages (they copy it); pure and only on the record's types.
 * The code comes out in the project's style (source.ts): no prettier needed.
 */

import {
  Arrow,
  Call,
  Code,
  importLine,
  property,
  quote,
  source,
} from './source';
import type { ProjectTool } from './project-tools';
import type { AgentPolicy } from '../../../src/policy/policy.interface';
import type {
  ActorSnapshot,
  DeclaredActor,
  RoundDeclaration,
  RoundRecord,
} from '../../../src/rounds/types';

/**
 * `{{said:analista}}`, `{{input:termo}}` or `{{repeat:index}}`: what a
 * prompt line brings in.
 */
const MARKER = /\{\{(said|input|repeat):([^}]+)\}\}/g;

/** The expression a marker stands for: `said['analista'] ?? ''`, `String(repeat.index)`. */
function markerValue(kind: string, name: string): string {
  if (kind === 'repeat') return `String(repeat.${name})`;
  return `${kind === 'said' ? 'said' : 'inputs'}[${quote(name)}] ?? ''`;
}

/** The rule functions `src/rounds` exports, by the id their rule reports. */
const RULES: Readonly<Partial<Record<string, string>>> = {
  'read-only-respected': 'readOnlyRespected',
  'no-questions': 'noQuestions',
  'no-tool-call-as-text': 'noToolCallAsText',
};

/** The provider classes `src/index` exports, by the name `describe()` gives. */
const PROVIDERS: Readonly<Partial<Record<string, string>>> = {
  ollama: 'OllamaProvider',
  claude: 'ClaudeProvider',
  cursor: 'CursorProvider',
  codex: 'CodexProvider',
};

/** One prompt line as an expression: a string, `said[…]`, `inputs[…]`, or a template. */
function promptLine(line: string): string {
  const whole = /^\{\{(said|input|repeat):([^}]+)\}\}$/.exec(line);
  if (whole?.[1] !== undefined && whole[2] !== undefined) {
    return markerValue(whole[1], whole[2]);
  }
  if (!new RegExp(MARKER.source).test(line)) return quote(line);
  const escaped = line
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('${', '\\${');
  return `\`${escaped.replace(MARKER, (_match, kind: string, name: string) => `\${${markerValue(kind, name)}}`)}\``;
}

/** The prompt's parameters: what of the context its lines use. */
function promptParams(lines: readonly string[]): string {
  const used = [
    ...(lines.some((line) => line.includes('{{said:')) ? ['said'] : []),
    ...(lines.some((line) => line.includes('{{input:')) ? ['inputs'] : []),
    ...(lines.some((line) => line.includes('{{repeat:')) ? ['repeat'] : []),
  ];
  return used.length === 0 ? '()' : `({ ${used.join(', ')} })`;
}

/**
 * While writing: the project's tools known (agents/tools), and the ones the
 * file imports, by import path.
 */
interface ToolImports {
  readonly known: readonly ProjectTool[];
  readonly used: Map<string, Set<string>>;
}

const toolImports = (known: readonly ProjectTool[]): ToolImports => ({
  known,
  used: new Map(),
});

/**
 * Tool names as values: a project's tool (`goiaba/…` registered in
 * agents/tools) as the export the file imports, anything else as its name.
 */
function toolValues(tools: readonly string[], imports: ToolImports): unknown[] {
  return tools.map((name) => {
    const tool = imports.known.find((known) => known.name === name);
    if (tool === undefined) return name;
    imports.used.set(
      tool.from,
      (imports.used.get(tool.from) ?? new Set()).add(tool.binding),
    );
    return new Code(tool.binding);
  });
}

/** The policy as a value: its tool rules naming the project's tools by export. */
function policyValue(policy: AgentPolicy, imports: ToolImports): unknown {
  const group = (rules: AgentPolicy['allow']): unknown =>
    rules?.tools === undefined
      ? rules
      : {
          ...rules,
          tools: rules.tools.map((rule) => ({
            ...rule,
            tools: toolValues(rule.tools, imports),
          })),
        };
  return {
    ...policy,
    ...(policy.allow === undefined ? {} : { allow: group(policy.allow) }),
    ...(policy.requireApproval === undefined
      ? {}
      : { requireApproval: group(policy.requireApproval) }),
    ...(policy.deny === undefined ? {} : { deny: group(policy.deny) }),
  };
}

/** One `import { … } from '…';` per path, in the order of the paths. */
const toolImportLines = (imports: ToolImports, prefix = ''): string[] =>
  [...imports.used]
    .map(([from, names]): [string, string[]] => [
      prefix === '' ? from : from.replace('../../agents/', prefix),
      [...names].toSorted(),
    ])
    .map(([from, names]) => importLine(names, from));

/** `new Provider({…})`, or a comment when this file does not know the class. */
function providerValue(
  provider: DeclaredActor['provider'],
  imports: ToolImports,
): unknown {
  const name = PROVIDERS[provider.name];
  const options = {
    ...(provider.cli === null ? {} : { cli: provider.cli }),
    ...(provider.model === null ? {} : { model: provider.model }),
    ...(provider.contextWindow === undefined
      ? {}
      : { contextWindow: provider.contextWindow }),
    ...(provider.think === undefined ? {} : { think: provider.think }),
    ...(provider.tools === undefined
      ? {}
      : { tools: toolValues(provider.tools, imports) }),
    ...provider.options,
  };
  return name === undefined
    ? new Code(`undefined /* provider "${provider.name}": escolha a classe */`)
    : new Call(`new ${name}`, options);
}

/**
 * The declaration as the source of `rounds/definitions/<id>.ts`, ready to
 * paste. A project's tool among `projectTools` comes out as its import. A
 * rule or provider this file does not know
 * comes out as a comment saying so; a prompt that could not be read, as a
 * comment too.
 */
export function declarationSource(
  declaration: RoundDeclaration,
  projectTools: readonly ProjectTool[] = [],
): string {
  const actors = Object.entries(declaration.actors);
  const providers = [
    ...new Set(
      actors
        .map(([, actor]) => PROVIDERS[actor.provider.name])
        .filter((name) => name !== undefined),
    ),
  ].toSorted();
  const rules = declaration.rules.map((id) => RULES[id]);
  const known = [
    ...new Set(rules.filter((name) => name !== undefined)),
  ].toSorted();
  const fixture = declaration.start !== null && 'fixture' in declaration.start;
  const gitRoot =
    declaration.start !== null && 'git' in declaration.start
      ? declaration.start.git.root
      : undefined;
  // One root for every actor when they share it: the round's folder.
  const roots = new Set(actors.map(([, actor]) => actor.workspace.root));
  const sharedRoot = roots.size === 1 && (fixture || gitRoot !== undefined);
  const root = new Code('root');
  const imports = toolImports(projectTools);

  const actorValues = Object.fromEntries(
    actors.map(([name, actor]) => {
      const { workspace } = actor;
      return [
        name,
        {
          provider: providerValue(actor.provider, imports),
          workspace: {
            type: workspace.type,
            ...(workspace.image === null ? {} : { image: workspace.image }),
            root: sharedRoot ? root : workspace.root,
            ...(workspace.hostState === null
              ? {}
              : { hostState: workspace.hostState }),
            ...(workspace.writable === undefined
              ? {}
              : { writable: workspace.writable }),
            ...(workspace.ports === undefined
              ? {}
              : { ports: workspace.ports }),
            ...(workspace.homes === undefined
              ? {}
              : { homes: workspace.homes }),
          },
          ...(actor.policy === null
            ? {}
            : { policy: policyValue(actor.policy, imports) }),
          ...(actor.readOnly ? { readOnly: true } : {}),
        },
      ];
    }),
  );

  const flowValues = declaration.flow.map((step) => ({
    actor: step.actor,
    ...(step.by === null ? {} : { by: step.by }),
    prompt:
      step.prompt === null
        ? // The prompt could not be read as lines: write it.
          new Code('() => [] /* o prompt deste passo não pôde ser lido */')
        : new Arrow(
            promptParams(step.prompt),
            step.prompt.map((line) => new Code(promptLine(line))),
          ),
  }));

  const round = {
    id: new Code('id'),
    goal: declaration.goal,
    ...(declaration.label === undefined ? {} : { label: declaration.label }),
    ...(declaration.start === null
      ? {}
      : 'fixture' in declaration.start
        ? { start: { fixture: declaration.start.fixture } }
        : {
            start: {
              git: {
                root: sharedRoot ? root : declaration.start.git.root,
                tag: declaration.start.git.tag,
              },
            },
          }),
    ...(declaration.inputs === undefined ? {} : { inputs: declaration.inputs }),
    actors: actorValues,
    flow: flowValues,
    ...(declaration.criteria === undefined
      ? {}
      : { criteria: declaration.criteria }),
    ...(declaration.rules.length === 0
      ? {}
      : {
          rules: declaration.rules.map((id, index) => {
            const name = rules[index];
            return new Code(
              name === undefined ? `/* regra "${id}" */` : `${name}()`,
            );
          }),
        }),
    ...(declaration.repeat === 1 ? {} : { repeat: declaration.repeat }),
  };
  const opening = 'export default defineRound(';

  return [
    // The project's tools (../../agents/…), then the Goiaba, by its package
    // name: the same file works in this repository and in any project that
    // installed it (or points rounds.definitions elsewhere).
    ...toolImportLines(imports),
    ...(providers.length === 0 ? [] : [importLine(providers, 'goiaba')]),
    importLine(
      [
        'defineRound',
        ...known,
        ...(fixture && sharedRoot ? ['roundDir'] : []),
      ].toSorted(),
      'goiaba/rounds',
    ),
    '',
    `const id = ${quote(declaration.id)};`,
    ...(sharedRoot
      ? [
          fixture
            ? 'const root = roundDir(id);'
            : `const root = ${quote(gitRoot ?? '')};`,
        ]
      : []),
    '',
    `${opening}${source(round, 0, opening.length, 2)});`,
    '',
  ].join('\n');
}

/**
 * One actor of a round as a standalone agent, ready to paste in `agents/`: a
 * `new Agent({…}).run()` with the provider, workspace, policy and tools it ran
 * with. The prompt is left as a placeholder (it is the task's, not the
 * agent's), and the workspace points at the configured folder. A provider this
 * file does not know comes out as a comment.
 */
export function agentSource(
  name: string,
  actor: RoundDeclaration['actors'][string],
  projectTools: readonly ProjectTool[] = [],
): string {
  const { workspace, provider } = actor;
  const providerClass = PROVIDERS[provider.name];
  const imports = toolImports(projectTools);
  const providerCode = providerValue(provider, imports);
  const policyCode =
    actor.policy === null ? null : policyValue(actor.policy, imports);
  const workspaceOptions = {
    type: workspace.type,
    ...(workspace.image === null ? {} : { image: workspace.image }),
    root: new Code('getConfig().workspaces.dir'),
    ...(workspace.hostState === null ? {} : { hostState: workspace.hostState }),
  };
  const workspaceHead = '    workspace: new Workspace(';

  const names = [
    'Agent',
    ...(providerClass === undefined ? [] : [providerClass]),
    'Workspace',
    'getConfig',
    'runScript',
  ].toSorted();

  return [
    importLine(names, 'goiaba'),
    // An agent lives in agents/, next to the tools (agents/tools).
    ...toolImportLines(imports, './'),
    '',
    'await runScript(async () => {',
    '  await new Agent({',
    `${property('name', name, 4, 1)},`,
    "    prompt: 'TODO: o pedido ao agente.',",
    `${property('provider', providerCode, 4, 1)},`,
    `${workspaceHead}${source(workspaceOptions, 4, workspaceHead.length, 2)}),`,
    ...(policyCode === null
      ? []
      : [`${property('policy', policyCode, 4, 1)},`]),
    '  }).run();',
    '});',
    '',
  ].join('\n');
}

/**
 * An actor as declared, from what the record kept of it when it ran: the
 * provider (its tools, when they were among its options), the workspace,
 * the policy. For records from before the declaration was kept.
 */
function declaredFromSnapshot(actor: ActorSnapshot): DeclaredActor {
  const { provider, workspace } = actor;
  const tools = provider.options['tools'];
  return {
    provider: {
      name: provider.name,
      cli: provider.cli,
      model: provider.model,
      ...(provider.contextWindow === undefined
        ? {}
        : { contextWindow: provider.contextWindow }),
      ...(provider.think === undefined ? {} : { think: provider.think }),
      ...(Array.isArray(tools) &&
      tools.every((tool) => typeof tool === 'string')
        ? { tools }
        : {}),
    },
    workspace: {
      type: workspace.type,
      image: workspace.image,
      root: workspace.root,
      hostState: workspace.hostState,
    },
    policy: actor.policy,
    readOnly: actor.readOnly,
  };
}

/**
 * The actor `name` of a round as declared: the declaration the record kept,
 * or, in older records, what it kept of the actor when it ran. `undefined`
 * when the round had no such actor.
 */
export function declaredActor(
  record: RoundRecord,
  name: string,
): DeclaredActor | undefined {
  const declared = record.declaration?.actors[name];
  if (declared !== undefined) return declared;
  const actor = record.actors[name];
  return actor === undefined ? undefined : declaredFromSnapshot(actor);
}
