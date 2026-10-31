import { createInstructor } from '../agents/instructor';
import { defineCommand, runCommand } from '../src/command/index';
import { UsageError } from '../src/errors';
import { currentDirectory } from '../src/execute/process';
import {
  ensureDirectory,
  isDirectory,
  join,
  listDirectory,
  pathExists,
} from '../src/filesystem/index';

await runCommand(
  defineCommand({
    name: 'generate-guides',
    description:
      'O Instructor (um agente Goiaba) lê src/<modulo> e escreve o curso em guides/<modulo>/curso.md.',
    args: {
      modulo: {
        description: 'Pasta em src/: command, logger…',
        required: true,
      },
    },
    options: {
      modelo: {
        type: 'string',
        short: 'm',
        value: 'modelo',
        default: 'instructor',
        description: 'Modelo do Ollama',
      },
    },
    run: async ({ args, options, output, signal }) => {
      const root = currentDirectory();
      const source = join(root, 'src', args.modulo);
      if (!pathExists(source) || !isDirectory(source)) {
        throw new UsageError(`Módulo não encontrado: ${source}`);
      }

      // The policy writes only here, and the sandbox mounts it: it must exist.
      ensureDirectory(join(root, 'guides', args.modulo));

      const files = sourceFiles(source);
      if (files.length === 0) {
        throw new UsageError(`Nenhum arquivo .ts em ${source}`);
      }

      await createInstructor({
        module: args.modulo,
        files,
        root,
        model: options.modelo,
        interaction: output,
        signal,
      }).run();

      const course = join(root, 'guides', args.modulo, 'curso.md');
      output.write(
        pathExists(course)
          ? `Curso em ${course}`
          : `O Instructor terminou sem escrever ${course}.`,
      );
    },
  }),
);

/** The `.ts`/`.tsx` files under `dir`, relative to it, in order. */
function sourceFiles(dir: string, prefix = ''): string[] {
  return listDirectory(dir)
    .toSorted()
    .flatMap((name) => {
      const path = join(dir, name);
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      if (isDirectory(path)) return sourceFiles(path, relative);
      return /\.tsx?$/.test(name) ? [relative] : [];
    });
}
