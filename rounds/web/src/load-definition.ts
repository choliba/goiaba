/**
 * A round's definition, pasted as source (`rounds/definitions/<id>.ts`),
 * read back as data (`RoundDeclaration`) to fill the "Criar rodada" form.
 * The source is the reader's own, run in this page: the types are stripped
 * (Sucrase, loaded on demand), and what it imports from the Goiaba is
 * replaced by stand-ins that only remember their options (a provider its
 * model, a rule its id), then read into data the way the engine's
 * `captureDeclaration` does. Only what the form needs is checked here: the
 * engine checks the rest when the round runs (`bun run rounds`). The pages
 * do not import the engine's declaration (it brings the whole agent).
 */

import { toolsFrom } from './known-tools';
import type { AgentPolicy } from '../../../src/policy/policy.interface';
import type {
  DeclaredActor,
  DeclaredOptionValue,
  FileCriterion,
  RoundCriterion,
  RoundDeclaration,
} from '../../../src/rounds/types';

/** A provider that only describes itself, as the real one would. */
function providerClass(name: string) {
  return class {
    public readonly id = name;
    public constructor(
      private readonly options: Readonly<Record<string, unknown>> = {},
    ) {}
    public declaredOptions(): Readonly<Record<string, unknown>> {
      return this.options;
    }
    public describe(): Record<string, unknown> {
      const { model, cli, contextWindow, think, tools } = this.options;
      return {
        name,
        model,
        cli,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(think === undefined ? {} : { think }),
        ...(tools === undefined ? {} : { tools }),
      };
    }
  };
}

/** A rule that only knows its id: the declaration keeps rules by id. */
const rule = (id: string) => (): { id: string; check: () => [] } => ({
  id,
  check: () => [],
});

/** What a definition may import from the Goiaba (src/…), as stand-ins. */
const GOIABA: Readonly<Record<string, unknown>> = {
  OllamaProvider: providerClass('ollama'),
  ClaudeProvider: providerClass('claude'),
  CodexProvider: providerClass('codex'),
  CursorProvider: providerClass('cursor'),
  defineRound: (definition: unknown) => definition,
  // The round's folder: kept as the id, written back as roundDir(id).
  roundDir: (id: string) => id,
  noQuestions: rule('no-questions'),
  readOnlyRespected: rule('read-only-respected'),
  noToolCallAsText: rule('no-tool-call-as-text'),
  tool: (definition: unknown) => definition,
  registerTool: (definition: { name: string }) => `goiaba/${definition.name}`,
  getConfig: () => ({ workspaces: { dir: '.' }, rounds: {} }),
  join: (...parts: string[]) => parts.join('/'),
};

/** Whether an import is the Goiaba's (src/…), the only ones stood in for. */
/**
 * Whether an import is the Goiaba's: its package (`goiaba`, `goiaba/rounds`)
 * or its source (`../../src/…`), the only ones stood in for.
 */
const isGoiaba = (path: string): boolean =>
  path === 'goiaba' ||
  path.startsWith('goiaba/') ||
  /(^|\/)src(\/|$)/.test(path);

/** A pasted definition, read as data; an `Error` saying what to fix. */
export async function declarationFromSource(
  source: string,
): Promise<RoundDeclaration> {
  const { transform } = await import('sucrase');
  let code: string;
  try {
    code = transform(source, { transforms: ['typescript', 'imports'] }).code;
  } catch (error) {
    throw new Error(
      `Não deu para ler a definição: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const others = new Set<string>();
  const require = (path: string): unknown => {
    if (isGoiaba(path)) return GOIABA;
    // A tool of the project: each export is the name it registers.
    const tools = toolsFrom(path.replace(/\.[jt]s$/, ''));
    if (tools.length > 0) {
      return Object.fromEntries(tools.map((tool) => [tool.binding, tool.name]));
    }
    others.add(path);
    return {};
  };
  const module = { exports: {} as Record<string, unknown> };
  try {
    // The reader's own source, run in the reader's own page: what the
    // form is for.
    // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
    new Function('require', 'module', 'exports', code)(
      require,
      module,
      module.exports,
    );
  } catch (error) {
    const hint =
      others.size === 0
        ? ''
        : ` Ela importa ${[...others].join(', ')}: cole uma definição que só importe do Goiaba (goiaba, goiaba/rounds) e das ferramentas do projeto (agents/tools), num arquivo só.`;
    throw new Error(
      `A definição não rodou: ${error instanceof Error ? error.message : String(error)}.${hint}`,
      { cause: error },
    );
  }

  if (others.size > 0) {
    // What came from there is missing: the form would be filled wrong.
    throw new Error(
      `A definição importa ${[...others].join(', ')}, que esta página não conhece: cole uma definição que só importe do Goiaba (goiaba, goiaba/rounds) e das ferramentas do projeto (agents/tools), num arquivo só.`,
    );
  }
  return declarationOf(module.exports['default']);
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A field of a record, when it is one. */
const field = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

/** `{{said:analista}}`: where a prompt puts what that actor said. */
const saidMarker = (actor: string): string => `{{said:${actor}}}`;

/** A record whose every entry is its marker. */
const markers = (mark: (key: string) => string): Record<string, string> =>
  new Proxy<Record<string, string>>(
    {},
    {
      get: (_target, key) => (typeof key === 'string' ? mark(key) : undefined),
    },
  );

/** A step's prompt lines, with each `said` and input marked; `null` when it fails so. */
function promptLines(prompt: unknown): string[] | null {
  if (typeof prompt !== 'function') return null;
  const said = markers(saidMarker);
  const inputs = markers((name) => `{{input:${name}}}`);
  const repeat = markers((name) => `{{repeat:${name}}}`);
  try {
    const lines: unknown = Reflect.apply(prompt, undefined, [
      { said, inputs, repeat },
    ]);
    return Array.isArray(lines) ? lines.map((line) => text(line)) : null;
  } catch {
    return null;
  }
}

/** A value as text, when it is text; `fallback` otherwise. */
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/** A value as text, or `null` when it is not text. */
const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/** The texts of a list; anything else left out. */
const texts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

/** The provider options the declaration's own fields already say. */
const MODELED = new Set(['cli', 'model', 'contextWindow', 'think', 'tools']);

/** The constructor's other options that are data, as written; `undefined` without any. */
function otherOptions(
  provider: unknown,
): Readonly<Record<string, DeclaredOptionValue>> | undefined {
  const given: unknown =
    isRecord(provider) && typeof provider['declaredOptions'] === 'function'
      ? Reflect.apply(provider['declaredOptions'], provider, [])
      : undefined;
  if (!isRecord(given)) return undefined;
  const entries = Object.entries(given).flatMap(
    ([key, value]): [string, DeclaredOptionValue][] => {
      if (MODELED.has(key)) return [];
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        return [[key, value]];
      }
      return Array.isArray(value) &&
        value.every((item): item is string => typeof item === 'string')
        ? [[key, value]]
        : [];
    },
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** Positive whole numbers of a list; anything else left out. */
const ports = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is number => Number.isInteger(item) && Number(item) > 0,
      )
    : [];

/** The flags of a file assertion that are given as true or false. */
const FILE_FLAGS = ['exists', 'created', 'deleted', 'changed'] as const;

/** A file assertion as data: each field checked, a `matches` RegExp as its source. */
function fileData(file: Readonly<Record<string, unknown>>): FileCriterion {
  const flags = Object.fromEntries(
    FILE_FLAGS.flatMap((flag) =>
      typeof file[flag] === 'boolean' ? [[flag, file[flag]]] : [],
    ),
  );
  const matches = file['matches'];
  return {
    name: text(file['name']),
    ...flags,
    ...(Array.isArray(file['ignore']) ? { ignore: texts(file['ignore']) } : {}),
    ...(Array.isArray(file['contains'])
      ? { contains: texts(file['contains']) }
      : {}),
    ...(Array.isArray(matches)
      ? {
          matches: matches.map((m) =>
            m instanceof RegExp ? m.source : text(m),
          ),
        }
      : {}),
    ...(typeof file['equals'] === 'string' ? { equals: file['equals'] } : {}),
  };
}

/** A criterion as data; `undefined` when it is none of the three kinds. */
function criterionData(criterion: unknown): RoundCriterion | undefined {
  const file = field(criterion, 'file');
  if (isRecord(file)) return { file: fileData(file) };
  const limit = field(criterion, 'limit');
  if (isRecord(limit)) {
    return {
      limit: {
        ...(typeof limit['time'] === 'string' ? { time: limit['time'] } : {}),
        ...(typeof limit['tokens'] === 'number'
          ? { tokens: limit['tokens'] }
          : {}),
        ...(typeof limit['cost'] === 'string' ? { cost: limit['cost'] } : {}),
      },
    };
  }
  const condition = field(criterion, 'if');
  if (isRecord(condition)) {
    const branch = (value: unknown): RoundCriterion[] =>
      Array.isArray(value)
        ? value.flatMap((item) => criterionData(item) ?? [])
        : [];
    const otherwise = field(criterion, 'else');
    return {
      if: {
        name: text(condition['name']),
        ...(typeof condition['exists'] === 'boolean'
          ? { exists: condition['exists'] }
          : {}),
        ...(Array.isArray(condition['contains'])
          ? { contains: texts(condition['contains']) }
          : {}),
      },
      check: branch(field(criterion, 'check')),
      ...(Array.isArray(otherwise) ? { else: branch(otherwise) } : {}),
    };
  }
  return undefined;
}

/** Whether a value looks like a policy (its rules are read field by field later). */
const isPolicy = (value: unknown): value is AgentPolicy =>
  isRecord(value) && typeof value['default'] === 'string';

/** The definition `export default` gave, read as a declaration. */
function declarationOf(definition: unknown): RoundDeclaration {
  if (!isRecord(definition)) {
    throw new Error(
      'A definição precisa exportar a rodada por padrão: export default defineRound({ … }).',
    );
  }
  const actors = field(definition, 'actors');
  const flow = field(definition, 'flow');
  if (
    typeof definition['id'] !== 'string' ||
    !isRecord(actors) ||
    !Array.isArray(flow)
  ) {
    throw new Error('A rodada precisa de id, actors e flow.');
  }
  const start = field(definition, 'start');
  const criteria = field(definition, 'criteria');
  const rules = field(definition, 'rules');
  return {
    id: definition['id'],
    goal: text(definition['goal']),
    start: isRecord(start)
      ? typeof start['fixture'] === 'string'
        ? { fixture: start['fixture'] }
        : {
            git: {
              root: text(field(start['git'], 'root')),
              tag: text(field(start['git'], 'tag')),
            },
          }
      : null,
    actors: Object.fromEntries(
      Object.entries(actors).map(([name, actor]): [string, DeclaredActor] => {
        const provider = field(actor, 'provider');
        const described: unknown =
          isRecord(provider) && typeof provider['describe'] === 'function'
            ? Reflect.apply(provider['describe'], provider, [])
            : undefined;
        const workspace = field(actor, 'workspace');
        const tools = field(described, 'tools');
        const contextWindow = field(described, 'contextWindow');
        const think = field(described, 'think');
        const options = otherOptions(provider);
        const writable = field(workspace, 'writable');
        const homes = field(workspace, 'homes');
        return [
          name,
          {
            provider: {
              name: text(field(described, 'name'), text(field(provider, 'id'))),
              cli: textOrNull(field(described, 'cli')),
              model: textOrNull(field(described, 'model')),
              ...(typeof contextWindow === 'number' ? { contextWindow } : {}),
              ...(typeof think === 'boolean' ? { think } : {}),
              ...(Array.isArray(tools) ? { tools: texts(tools) } : {}),
              ...(options === undefined ? {} : { options }),
            },
            workspace: {
              type:
                field(workspace, 'type') === 'docker' ? 'docker' : 'bubblewrap',
              image: textOrNull(field(workspace, 'image')),
              root: text(field(workspace, 'root')),
              hostState: ((): DeclaredActor['workspace']['hostState'] => {
                const state = field(workspace, 'hostState');
                return state === 'none' ||
                  state === 'login' ||
                  state === 'share'
                  ? state
                  : null;
              })(),
              ...(Array.isArray(writable) ? { writable: texts(writable) } : {}),
              ...(Array.isArray(field(workspace, 'ports'))
                ? { ports: ports(field(workspace, 'ports')) }
                : {}),
              ...(typeof homes === 'string' ? { homes } : {}),
            },
            policy: ((): AgentPolicy | null => {
              const policy = field(actor, 'policy');
              return isPolicy(policy) ? policy : null;
            })(),
            readOnly: field(actor, 'readOnly') === true,
          },
        ];
      }),
    ),
    flow: flow.map((step) => ({
      actor: text(field(step, 'actor')),
      by: textOrNull(field(step, 'by')),
      prompt: promptLines(field(step, 'prompt')),
    })),
    rules: Array.isArray(rules)
      ? rules.map((entry) => text(field(entry, 'id')))
      : [],
    ...(isRecord(criteria)
      ? {
          criteria: Object.fromEntries(
            Object.entries(criteria).map(([name, list]) => [
              name,
              Array.isArray(list)
                ? list.flatMap((item) => criterionData(item) ?? [])
                : [],
            ]),
          ),
        }
      : {}),
    ...((): Partial<RoundDeclaration> => {
      const inputs = field(definition, 'inputs');
      if (!isRecord(inputs)) return {};
      return {
        inputs: Object.fromEntries(
          Object.entries(inputs).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ),
      };
    })(),
    repeat: typeof definition['repeat'] === 'number' ? definition['repeat'] : 1,
  };
}
