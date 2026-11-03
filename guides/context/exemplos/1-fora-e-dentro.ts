/** Exemplo 1 do curso de context: consultar o contexto antes e durante um agente. */
import { writeOut } from '../../../src/output/stdio';
import { runAs, currentContext } from '../../../src/context/index';

writeOut(`fora: ${JSON.stringify(currentContext())}\n`);

runAs({ name: 'revisor', provider: { name: 'claude', model: 'haiku' } }, () => {
  const context = currentContext();
  writeOut(
    `dentro: ${context.agent} / ${context.agentProvider?.name}, execução: ${context.run === undefined ? 'não' : 'sim'}\n`,
  );
});

writeOut(`depois: ${JSON.stringify(currentContext())}\n`);
