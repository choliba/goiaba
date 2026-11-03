/** Exemplo 5 do curso de providers: inspecionar o acesso declarado ao host. */
import { writeOut } from '../../../src/output/stdio';
import { ClaudeProvider } from '../../../src/providers/claude/claude-provider';
import { CodexProvider } from '../../../src/providers/codex/codex-provider';

for (const provider of [
  new ClaudeProvider({ model: 'modelo' }),
  new CodexProvider({ model: 'modelo' }),
]) {
  const access = provider.hostAccess();
  writeOut(`${provider.id}: ${JSON.stringify(access.homeEnv)}\n`);
  writeOut(`  credenciais de ambiente: ${access.credentialEnv.join(', ')}\n`);
}
