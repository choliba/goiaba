/**
 * Exemplo 7 do curso de filesystem: outros processos pelo /proc (Linux). O
 * /proc é uma visão do sistema em forma de arquivos; ler é disco, então
 * mora aqui. Quem usa: a sandbox, o lock do agente e o broker.
 */
import { currentDirectory, currentPid } from '../../../src/execute/process';
import {
  processAlive,
  processChildren,
  processCwd,
  processName,
  processNamespace,
} from '../../../src/filesystem/proc';
import { writeOut } from '../../../src/output/terminal';

const pid = currentPid();
writeOut(`processName(este): ${String(processName(pid))}\n`);
writeOut(
  `processCwd(este) é o diretório atual: ${String(processCwd(pid) === currentDirectory())}\n`,
);
writeOut(`processAlive(este): ${String(processAlive(pid))}\n`);
writeOut(`processAlive(999999): ${String(processAlive(999_999))}\n`);
writeOut(`processChildren(este): ${JSON.stringify(processChildren(pid))}\n`);
writeOut(
  `processNamespace(este, 'net') começa com net:[ ${String(processNamespace(pid, 'net')?.startsWith('net:['))}\n`,
);
