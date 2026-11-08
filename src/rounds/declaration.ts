/**
 * A round's declaration back from data (`RoundDeclaration`, captured by
 * `captureDeclaration` when it ran) to the source of
 * `rounds/definitions/<id>.ts`. Pure and only on the record's types: the
 * pages use it to copy a round's declaration.
 */

import type { DeclaredActor, RoundDeclaration } from './types';

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

/** `value` as a TypeScript literal, its lines after the first indented. */
function literal(value: unknown, indent: string): string {
  return JSON.stringify(value, null, 2).replaceAll('\n', `\n${indent}`);
}

/** One prompt line as an expression: a string, `said[…]`, or a template. */
function promptLine(line: string): string {
  const whole = /^\{\{said:([^}]+)\}\}$/.exec(line);
  if (whole?.[1] !== undefined) {
    return `said[${JSON.stringify(whole[1])}] ?? ''`;
  }
  if (!line.includes('{{said:')) return JSON.stringify(line);
  const escaped = line
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('${', '\\${');
  return `\`${escaped.replace(SAID, (_match, actor: string) => `\${said[${JSON.stringify(actor)}] ?? ''}`)}\``;
}

function providerSource(provider: DeclaredActor['provider']): string {
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
    ? `undefined /* provider "${provider.name}": escolha a classe */`
    : `new ${name}(${JSON.stringify(options)})`;
}

/**
 * The declaration as the source of `rounds/definitions/<id>.ts`, ready to
 * paste (run prettier on it). A rule or provider this file does not know
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

  const actorLines = actors.flatMap(([name, actor]) => {
    const { workspace } = actor;
    const ws = [`type: ${JSON.stringify(workspace.type)}`];
    if (workspace.image !== null) {
      ws.push(`image: ${JSON.stringify(workspace.image)}`);
    }
    ws.push(sharedRoot ? 'root' : `root: ${JSON.stringify(workspace.root)}`);
    if (workspace.hostState !== null) {
      ws.push(`hostState: ${JSON.stringify(workspace.hostState)}`);
    }
    const lines = [
      `    ${JSON.stringify(name)}: {`,
      `      provider: ${providerSource(actor.provider)},`,
      `      workspace: { ${ws.join(', ')} },`,
    ];
    if (actor.permissions !== null) {
      lines.push(`      permissions: ${literal(actor.permissions, '      ')},`);
    }
    if (actor.readOnly) lines.push('      readOnly: true,');
    lines.push('    },');
    return lines;
  });

  const flowLines = declaration.flow.flatMap((step) => {
    const head = [
      '    {',
      `      actor: ${JSON.stringify(step.actor)},`,
      ...(step.by === null ? [] : [`      by: ${JSON.stringify(step.by)},`]),
    ];
    if (step.prompt === null) {
      return [
        ...head,
        '      // O prompt deste passo não pôde ser lido como linhas: escreva-o.',
        '      prompt: () => [],',
        '    },',
      ];
    }
    const usesSaid = step.prompt.some((line) => line.includes('{{said:'));
    return [
      ...head,
      `      prompt: (${usesSaid ? '{ said }' : ''}) => [`,
      ...step.prompt.map((line) => `        ${promptLine(line)},`),
      '      ],',
      '    },',
    ];
  });

  const ruleSource = declaration.rules.map((id, index) => {
    const name = rules[index];
    return name === undefined ? `/* regra "${id}" */` : `${name}()`;
  });

  return [
    ...(providers.length === 0
      ? []
      : [`import { ${providers.join(', ')} } from '../../src/index';`]),
    `import { ${[
      'defineRound',
      ...known,
      ...(fixture && sharedRoot ? ['roundDir'] : []),
    ]
      .toSorted()
      .join(', ')} } from '../../src/rounds/index';`,
    '',
    `const id = ${JSON.stringify(declaration.id)};`,
    ...(sharedRoot
      ? [
          fixture
            ? 'const root = roundDir(id);'
            : `const root = ${JSON.stringify(gitRoot)};`,
        ]
      : []),
    '',
    'export default defineRound({',
    '  id,',
    `  goal: ${JSON.stringify(declaration.goal)},`,
    ...(declaration.label === undefined
      ? []
      : [`  label: ${JSON.stringify(declaration.label)},`]),
    ...(declaration.start === null
      ? []
      : 'fixture' in declaration.start
        ? [
            `  start: { fixture: ${JSON.stringify(declaration.start.fixture)} },`,
          ]
        : [
            `  start: { git: { root${sharedRoot ? '' : `: ${JSON.stringify(declaration.start.git.root)}`}, tag: ${JSON.stringify(declaration.start.git.tag)} } },`,
          ]),
    '  actors: {',
    ...actorLines,
    '  },',
    '  flow: [',
    ...flowLines,
    '  ],',
    ...(declaration.instructions === undefined
      ? []
      : [`  instructions: ${literal(declaration.instructions, '  ')},`]),
    ...(declaration.limits === undefined
      ? []
      : [`  limits: ${literal(declaration.limits, '  ')},`]),
    ...(declaration.rules.length === 0
      ? []
      : [`  rules: [${ruleSource.join(', ')}],`]),
    ...(declaration.repeat === 1
      ? []
      : [`  repeat: ${String(declaration.repeat)},`]),
    '});',
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
  const ws = [`type: ${JSON.stringify(workspace.type)}`];
  if (workspace.image !== null)
    ws.push(`image: ${JSON.stringify(workspace.image)}`);
  ws.push('root: getConfig().workspaces.dir');
  if (workspace.hostState !== null) {
    ws.push(`hostState: ${JSON.stringify(workspace.hostState)}`);
  }

  const imports = [
    'Agent',
    ...(providerClass === undefined ? [] : [providerClass]),
    'Workspace',
    'getConfig',
    'runScript',
  ].toSorted();

  return [
    `import { ${imports.join(', ')} } from '../src/index';`,
    '',
    'await runScript(async () => {',
    '  await new Agent({',
    `    name: ${JSON.stringify(name)},`,
    "    prompt: 'TODO: o pedido ao agente.',",
    `    provider: ${providerSource(provider)},`,
    `    workspace: new Workspace({ ${ws.join(', ')} }),`,
    ...(actor.permissions === null
      ? []
      : [`    permissions: ${literal(actor.permissions, '    ')},`]),
    '  }).run();',
    '});',
    '',
  ].join('\n');
}
