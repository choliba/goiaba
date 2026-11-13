/**
 * The coverage ratchet, after `bun test --coverage` (`bun run test:cov`):
 * the total is checked against coverage-thresholds.json. Below any
 * threshold, the run fails and every file stays as it was (they show the
 * last good state). Otherwise the thresholds rise to what the run reached,
 * never down, and COVERAGE.md and the badge are rewritten. A file is
 * rewritten only when its content changes (the generation time does not
 * count), so running the tests leaves the tree clean.
 */

import {
  ensureDirectory,
  join,
  pathExists,
  readText,
  resolve,
  writeText,
} from '../src/filesystem/index';
import { setExitCode } from '../src/execute/process';
import { writeOut, writeErr } from '../src/output/stdio';
import {
  belowThresholds,
  coverageBadge,
  coverageMarkdown,
  GENERATED_LINE,
  parseLcov,
  ratchet,
  readThresholds,
  thresholdsJson,
  totalCoverage,
} from './coverage-report';

const root = resolve(import.meta.dir, '..');
const lcovPath = join(root, 'coverage', 'lcov.info');
const thresholdsPath = join(root, 'coverage-thresholds.json');

/** A percent as the terminal shows it: `93.56%`. */
const pct = (value: number): string => `${value.toFixed(2)}%`;

/** Writes `content` only when it differs from the file (`ignore` left out). */
function writeIfChanged(
  path: string,
  content: string,
  ignore?: RegExp,
): boolean {
  if (pathExists(path)) {
    const normalize = (text: string): string =>
      ignore === undefined ? text : text.replace(ignore, '');
    if (normalize(readText(path)) === normalize(content)) return false;
  }
  ensureDirectory(join(path, '..'));
  writeText(path, content);
  return true;
}

if (!pathExists(lcovPath)) {
  writeErr('Sem coverage/lcov.info: rode bun test --coverage antes.\n');
  setExitCode(1);
} else {
  const files = parseLcov(readText(lcovPath));
  const actual = totalCoverage(files);
  const current = readThresholds(readText(thresholdsPath));

  if (belowThresholds(actual, current)) {
    writeErr(
      `Cobertura abaixo do limite: funções ${pct(actual.functions)} (limite ${pct(current.functions)}), linhas ${pct(actual.lines)} (limite ${pct(current.lines)}). A correção é um teste, não um número: veja COVERAGE.md. Nada foi regravado.\n`,
    );
    setExitCode(1);
  } else {
    const next = ratchet(actual, current);
    const raised = writeIfChanged(thresholdsPath, thresholdsJson(next));
    writeIfChanged(
      join(root, 'COVERAGE.md'),
      coverageMarkdown(files, next),
      GENERATED_LINE,
    );
    writeIfChanged(
      join(root, '.github', 'badges', 'coverage.json'),
      `${JSON.stringify(coverageBadge(actual), null, 2)}\n`,
    );
    writeOut(
      `Cobertura: funções ${pct(actual.functions)}, linhas ${pct(actual.lines)}.${
        raised
          ? ` Limites subiram para funções ${pct(next.functions)}, linhas ${pct(next.lines)}.`
          : ''
      }\n`,
    );
  }
}
