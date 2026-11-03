/**
 * Exemplo 4 do curso de input: o stdin tem um leitor só. Um segundo
 * `readStream()` ao mesmo tempo é recusado com um UsageError, para que um
 * byte nunca vá para dois leitores. Depois que o primeiro acaba, ler de
 * novo termina na hora: não há mais nada.
 */
import { UsageError } from '../../../src/errors';
import { read, readStream } from '../../../src/input/index';
import { writeOut } from '../../../src/output/stdio';

const first = readStream()[Symbol.asyncIterator]();
const reading = first.next();

try {
  await readStream()[Symbol.asyncIterator]().next();
} catch (error) {
  if (error instanceof UsageError)
    writeOut(`segundo leitor: ${error.message}\n`);
}

writeOut(`o primeiro leu: ${JSON.stringify((await reading).value)}\n`);
await first.return(undefined);
writeOut(`o resto: ${JSON.stringify(await read())}\n`);
writeOut(`de novo: ${JSON.stringify(await read())}\n`);
