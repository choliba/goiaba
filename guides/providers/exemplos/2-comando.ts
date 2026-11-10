/** Exemplo 2 do curso de providers: ver o comando que uma CLI receberia. */
import { writeOut } from '../../../src/output/stdio';
import { CursorProvider } from '../../../src/providers/cursor/cursor-provider';

const provider = new CursorProvider({ model: 'modelo-local' });
const command = provider.createCommand('Resuma o projeto.', undefined, '/app');

writeOut(`${command.executable} ${command.arguments?.join(' ')}\n`);
writeOut(`entrada: ${command.input?.split('\n')[0]}\n`);
