/**
 * Registers cleanups with `onProgramExit`, then ends the way the first
 * argument says, for test/input.test.ts. Each cleanup prints its name.
 */
import { exitProgram, onProgramExit } from '../../src/execute/process';

const mode = process.argv[2];

onProgramExit(() => {
  process.stdout.write('limpou\n');
});
const stop = onProgramExit(() => {
  process.stdout.write('desinscrito\n');
});
stop();

if (mode === 'exit') exitProgram(3);
if (mode === 'signal') {
  process.stdout.write('pronto\n');
  setInterval(() => undefined, 1000);
}
// 'end': the work is over and the program ends by itself.
