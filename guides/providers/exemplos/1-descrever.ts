/** Exemplo 1 do curso de providers: descrever um provider sem rodar a CLI. */
import { writeOut } from '../../../src/output/stdio';
import { ClaudeProvider } from '../../../src/providers/claude/claude-provider';

const provider = new ClaudeProvider({ model: 'claude-haiku' });
const description = provider.describe();

writeOut(`${description.name} / ${description.model}\n`);
