import { UsageError } from '../../errors';
import { delegatedCategories } from '../../policy/index';
import type {
  AgentPolicy,
  PolicyCategory,
  PolicyGroups,
  PolicyRule,
} from '../../policy/policy.interface';
import type { PolicyTranslation, UnsupportedRule } from '../provider.interface';
import type { ExecutionGate } from '../types';

/**
 * What the Cursor CLI (`agent`) itself understands: `--force` in `--print`,
 * because nobody is there to approve. Paths and network stay the sandbox's.
 */
export interface CursorPermissions {
  readonly force: true;
}

/**
 * Extra argv the CLI would receive beyond `--trust --force`. Empty until the
 * CLI can apply a category itself.
 */
export interface CursorCommandPolicy {
  readonly arguments: readonly string[];
}

type Source = UnsupportedRule['source'];

const SOURCES: readonly Source[] = ['allow', 'requireApproval', 'deny'];

/**
 * Categories the CLI does not express. Filesystem and network are the
 * sandbox's; secrets go through `hostAccess`.
 */
const CLI_CATEGORIES = [
  'web',
  'execution',
  'tools',
  'agents',
  'communication',
] as const satisfies readonly PolicyCategory[];

const REASONS: Readonly<Record<(typeof CLI_CATEGORIES)[number], string>> = {
  web: 'A CLI do Cursor não tem listas de permissão web.',
  execution:
    'A CLI do Cursor não decide comandos: --force no --print, a sandbox é o limite.',
  tools: 'A CLI do Cursor não expõe permissões de ferramentas (MCP).',
  agents: 'A CLI do Cursor não expõe permissões de subagentes.',
  communication: 'A CLI do Cursor não aplica a categoria communication.',
};

/**
 * An `AgentPolicy` as the Cursor CLI expresses it: `--force` in `--print`.
 * Pure: nothing is written. What the CLI cannot express goes to
 * `unsupported`.
 */
export function translateCursorPolicy(
  policy: AgentPolicy,
): PolicyTranslation<CursorPermissions> {
  const unsupported: UnsupportedRule[] = [];

  for (const source of SOURCES) {
    const groups: PolicyGroups = policy[source] ?? {};

    for (const category of CLI_CATEGORIES) {
      for (const rule of rulesOf(groups, category)) {
        unsupported.push({
          category,
          source,
          rule,
          reason: REASONS[category],
          // --force does not restrict: an allow list is not a limit, and a
          // denial or an approval is not enforced.
          effect: 'looser',
        });
      }
    }
  }

  return { native: { force: true }, unsupported };
}

/**
 * What the CLI must receive to apply what the sandbox cannot. `undefined`
 * when the sandbox is the limit (`--trust --force`). Throws a `UsageError`
 * for a category the CLI does not apply.
 */
export function cursorCommandPolicy(
  policy: AgentPolicy,
  _gate: ExecutionGate | undefined,
): CursorCommandPolicy | undefined {
  const category = delegatedCategories(policy).at(0);

  if (category !== undefined) {
    throw new UsageError(
      `O provider cursor ainda não aplica a categoria ${category}.`,
    );
  }

  return undefined;
}

function rulesOf(
  groups: PolicyGroups,
  category: (typeof CLI_CATEGORIES)[number],
): readonly PolicyRule[] {
  return groups[category] ?? [];
}
