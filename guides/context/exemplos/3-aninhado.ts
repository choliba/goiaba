/** Exemplo 3 do curso de context: herdar e trocar o contexto de agente. */
import { writeOut } from '../../../src/output/stdio';
import { runAs, currentContext } from '../../../src/context/index';

runAs({ name: 'coordenador' }, () => {
  const parentRun = currentContext().run;

  runAs({ name: 'coordenador' }, () => {
    writeOut(`mesma execução: ${currentContext().run === parentRun}\n`);
  });

  runAs({ name: 'pesquisador' }, () => {
    writeOut(
      `agente filho: ${currentContext().agent}; execução própria: ${currentContext().run !== parentRun}\n`,
    );
  });

  writeOut(`contexto restaurado: ${currentContext().agent}\n`);
});
