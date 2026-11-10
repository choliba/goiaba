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
import type {
  ActorSnapshot,
  DeclaredActor,
  RoundDeclaration,
  RoundRecord,
} from '../../../src/rounds/types';

const SAID = /\{\{said:([^}]+)\}\}/g;

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

/** One prompt line as an expression: a string, `said[…]`, or a template. */
function promptLine(line: string): string {
  const whole = /^\{\{said:([^}]+)\}\}$/.exec(line);
  if (whole?.[1] !== undefined) {
    return `said[${quote(whole[1])}] ?? ''`;
  }
  if (!line.includes('{{said:')) return quote(line);
  const escaped = line
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('${', '\\${');
  return `\`${escaped.replace(SAID, (_match, actor: string) => `\${said[${quote(actor)}] ?? ''}`)}\``;
}

/** `new Provider({…})`, or a comment when this file does not know the class. */
function providerValue(provider: DeclaredActor['provider']): unknown {
  const name = PROVIDERS[provider.name];
  const options = {
    ...(provider.cli === null ? {} : { cli: provider.cli }),
    ...(provider.model === null ? {} : { model: provider.model }),
    ...(provider.contextWindow === undefined
      ? {}
      : { contextWindow: provider.contextWindow }),
    ...(provider.think === undefined ? {} : { think: provider.think }),
    ...(provider.tools === undefined ? {} : { tools: provider.tools }),
  };
  return name === undefined
    ? new Code(`undefined /* provider "${provider.name}": escolha a classe */`)
    : new Call(`new ${name}`, options);
}

/**
 * The declaration as the source of `rounds/definitions/<id>.ts`, ready to
 * paste. A rule or provider this file does not know
 * comes out as a comment saying so; a prompt that could not be read, as a
 * comment too.
 */
export function declarationSource(declaration: RoundDeclaration): string {
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

  const actorValues = Object.fromEntries(
    actors.map(([name, actor]) => {
      const { workspace } = actor;
      return [
        name,
        {
          provider: providerValue(actor.provider),
          workspace: {
            type: workspace.type,
            ...(workspace.image === null ? {} : { image: workspace.image }),
            root: sharedRoot ? root : workspace.root,
            ...(workspace.hostState === null
              ? {}
              : { hostState: workspace.hostState }),
          },
          ...(actor.policy === null ? {} : { policy: actor.policy }),
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
            step.prompt.some((line) => line.includes('{{said:'))
              ? '({ said })'
              : '()',
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
    ...(providers.length === 0
      ? []
      : [importLine(providers, '../../src/index')]),
    importLine(
      [
        'defineRound',
        ...known,
        ...(fixture && sharedRoot ? ['roundDir'] : []),
      ].toSorted(),
      '../../src/rounds/index',
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
): string {
  const { workspace, provider } = actor;
  const providerClass = PROVIDERS[provider.name];
  const workspaceOptions = {
    type: workspace.type,
    ...(workspace.image === null ? {} : { image: workspace.image }),
    root: new Code('getConfig().workspaces.dir'),
    ...(workspace.hostState === null ? {} : { hostState: workspace.hostState }),
  };
  const workspaceHead = '    workspace: new Workspace(';

  const imports = [
    'Agent',
    ...(providerClass === undefined ? [] : [providerClass]),
    'Workspace',
    'getConfig',
    'runScript',
  ].toSorted();

  return [
    importLine(imports, '../src/index'),
    '',
    'await runScript(async () => {',
    '  await new Agent({',
    `${property('name', name, 4, 1)},`,
    "    prompt: 'TODO: o pedido ao agente.',",
    `${property('provider', providerValue(provider), 4, 1)},`,
    `${workspaceHead}${source(workspaceOptions, 4, workspaceHead.length, 2)}),`,
    ...(actor.policy === null
      ? []
      : [`${property('policy', actor.policy, 4, 1)},`]),
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
