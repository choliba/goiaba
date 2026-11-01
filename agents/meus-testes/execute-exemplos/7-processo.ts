/**
 * Exemplo 7 do curso de execute: o processo atual e programas auxiliares
 * (process.ts) e Ctrl+C como AbortSignal (interrupt.ts). Nada aqui usa o
 * Executor. Para olhar o próprio processo, o /proc é lido pelo filesystem
 * (src/filesystem/proc.ts), não pelo execute.
 */
import { listenForInterrupt } from '../../../src/execute/interrupt';
import { processAlive, processName } from '../../../src/filesystem/proc';
import {
  currentPid,
  environment,
  interruptProgram,
  programArguments,
  runProgram,
} from '../../../src/execute/process';
import { writeOut } from '../../../src/output/terminal';

// O processo atual, sem tocar em `process` direto.
writeOut(`argumentos: ${JSON.stringify(programArguments())}\n`);
writeOut(`HOME definido: ${String(environment()['HOME'] !== undefined)}\n`);
writeOut(
  `este processo: ${processName(currentPid()) ?? '?'}, vivo: ${String(processAlive(currentPid()))}\n`,
);

// Um programa auxiliar curto: espera terminar e devolve a saída.
const kernel = await runProgram('uname', ['-s'], { timeoutMs: 5000 });
writeOut(`uname -s: ${kernel.trim()}\n`);

// Ctrl+C vira um AbortSignal; aqui o próprio programa se manda o SIGINT.
const interrupt = listenForInterrupt();
interrupt.signal.addEventListener('abort', () => {
  writeOut('Ctrl+C recebido: o trabalho pode limpar e parar\n');
});
interruptProgram();
await new Promise((resolve) => setTimeout(resolve, 50));
writeOut(`signal.aborted: ${String(interrupt.signal.aborted)}\n`);
interrupt.dispose();
