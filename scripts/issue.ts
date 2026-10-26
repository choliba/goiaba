import { randomUUID } from 'node:crypto';

import { defineCommand, runCommand } from '../src/command/index';
import { UsageError } from '../src/errors';
import { goiabaCacheDir, runProgram } from '../src/execute/process';
import {
  ensureDirectory,
  pathExists,
  readText,
  removePath,
  writeText,
  join,
} from '../src/filesystem/index';

/**
 * Opens a GitHub issue from a Markdown file whose frontmatter gives
 * `title`, `labels` and, optionally, `repo`; the rest is the issue body.
 */
interface Frontmatter {
  readonly title: string;
  readonly labels: readonly string[];
  readonly repo: string | undefined;
}

const GH_TIMEOUT_MS = 60_000;

await runCommand(
  defineCommand({
    name: 'issue',
    description:
      'Abre uma issue no GitHub a partir de um Markdown com frontmatter (title, labels, repo).',
    args: {
      arquivo: { description: 'Markdown do plano', required: true },
    },
    options: {
      repo: {
        type: 'string',
        short: 'r',
        value: 'owner/nome',
        description: 'Repositório; vale mais que o repo do frontmatter',
      },
      dry: {
        type: 'boolean',
        short: 'd',
        description: 'Mostra a issue sem criá-la',
      },
    },
    run: async ({ args, options, output }) => {
      if (!pathExists(args.arquivo)) {
        throw new UsageError(`Arquivo não encontrado: ${args.arquivo}`);
      }

      const { frontmatter, body } = parse(args.arquivo, readText(args.arquivo));
      const repo = options.repo ?? frontmatter.repo;
      const repoArgs = repo === undefined ? [] : ['--repo', repo];

      if (options.dry) {
        output.write(
          [
            `Título: ${frontmatter.title}`,
            `Labels: ${frontmatter.labels.join(', ') || '—'}`,
            `Repositório: ${repo ?? 'o do remote origin'}`,
            '',
            body,
          ].join('\n'),
        );
        return;
      }

      for (const label of frontmatter.labels) {
        await ensureLabel(label, repoArgs);
      }

      const dir = join(goiabaCacheDir(), 'issue', randomUUID());
      ensureDirectory(dir, 0o700);
      try {
        const bodyFile = join(dir, 'body.md');
        writeText(bodyFile, body);
        output.write(
          await gh([
            'issue',
            'create',
            ...repoArgs,
            '--title',
            frontmatter.title,
            ...frontmatter.labels.flatMap((label) => ['--label', label]),
            '--body-file',
            bodyFile,
          ]),
        );
      } finally {
        removePath(dir);
      }
    },
  }),
);

function parse(
  file: string,
  text: string,
): { frontmatter: Frontmatter; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (match === null) {
    throw new UsageError(`${file}: falta o frontmatter (--- title: … ---).`);
  }

  const fields = new Map<string, string>();
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }

  const title = unquote(fields.get('title') ?? '');
  if (title.length === 0) {
    throw new UsageError(`${file}: o frontmatter precisa de title.`);
  }

  const labels = (fields.get('labels') ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((label) => unquote(label.trim()))
    .filter((label) => label.length > 0);
  const repo = fields.get('repo');

  return {
    frontmatter: {
      title,
      labels,
      repo: repo === undefined ? undefined : unquote(repo),
    },
    body: text.slice(match[0].length).trimStart(),
  };
}

function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

/** gh refuses unknown labels: create them first. */
async function ensureLabel(
  label: string,
  repoArgs: readonly string[],
): Promise<void> {
  const existing = await gh([
    'label',
    'list',
    ...repoArgs,
    '--search',
    label,
    '--json',
    'name',
    '--jq',
    '.[].name',
  ]);
  if (existing.split('\n').includes(label)) return;
  await gh(['label', 'create', ...repoArgs, label]);
}

async function gh(args: readonly string[]): Promise<string> {
  try {
    return (await runProgram('gh', args, { timeoutMs: GH_TIMEOUT_MS })).trim();
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr).trim()
        : String(error);
    throw new UsageError(`gh ${args.slice(0, 2).join(' ')}: ${stderr}`);
  }
}
