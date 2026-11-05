/**
 * A step's checkable instructions, against the workspace: each condition
 * (`when`) at the start of the step, before the agent acts; each check at
 * the end. Only the verdict is kept, never the file.
 */

import { isDirectory, join, pathExists, readText } from '../filesystem/index';
import type { InstructionResult, RoundCheck, RoundInstruction } from './types';

type FileCheck = { readonly file: string; readonly contains?: string };

/** `tickets/a.txt existe`, `tickets/a.txt contém "X"`, `não alterou nada`. */
export function describe(check: RoundCheck): string {
  if ('unchanged' in check) return 'não alterou nada';
  return check.contains === undefined
    ? `${check.file} existe`
    : `${check.file} contém "${check.contains}"`;
}

/** The file check, now: whether it holds, and why. */
function fileHolds(
  { file, contains }: FileCheck,
  root: string,
): { readonly held: boolean; readonly detail: string } {
  const path = join(root, file);
  if (!pathExists(path) || isDirectory(path)) {
    return { held: false, detail: `${file} não existe.` };
  }
  if (contains === undefined) return { held: true, detail: `${file} existe.` };
  const found = readText(path)
    .toLocaleLowerCase('pt-BR')
    .includes(contains.toLocaleLowerCase('pt-BR'));
  return {
    held: found,
    detail: found
      ? `${file} contém "${contains}".`
      : `${file} existe, mas não contém "${contains}".`,
  };
}

/** At the start of the step: whether each instruction's condition holds. */
export function conditionsAt(
  instructions: readonly RoundInstruction[],
  root: string,
): readonly (boolean | null)[] {
  return instructions.map(({ when }) =>
    when === undefined ? null : fileHolds(when, root).held,
  );
}

/**
 * At the end of the step: each instruction that applies, checked. An
 * instruction whose condition did not hold, with no `otherwise`, does not
 * apply and is left out.
 */
export function checkInstructions(
  instructions: readonly RoundInstruction[],
  conditions: readonly (boolean | null)[],
  root: string,
  changed: readonly string[],
): InstructionResult[] {
  return instructions.flatMap((instruction, index): InstructionResult[] => {
    const held = conditions[index] ?? null;
    const check = held === false ? instruction.otherwise : instruction.check;
    if (check === undefined) return [];
    const when =
      instruction.when === undefined || held === null
        ? null
        : { check: describe(instruction.when), held };
    const verdict =
      'unchanged' in check
        ? changed.length === 0
          ? { held: true, detail: 'Não alterou nada.' }
          : { held: false, detail: `Alterou: ${changed.join(', ')}.` }
        : fileHolds(check, root);
    return [
      {
        check: describe(check),
        when,
        met: verdict.held,
        detail: verdict.detail,
      },
    ];
  });
}
