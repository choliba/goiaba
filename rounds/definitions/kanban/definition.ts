/**
 * A peça "definition": o centralizador. Todas as escolhas da rodada estão
 * aqui, como parâmetros das peças; as peças só sabem montar.
 */

import type { RoundDefinition } from '../../../src/rounds';
import { actor } from './actor';
import { actors } from './actors';
import { ACTOR_NAMES } from './actors-names';
import { criteria } from './criteria';
import { demand } from './demand';
import { devTask } from './dev-task';
import { flow } from './flow';
import { goal } from './goal';
import { ID } from './id';
import { policy } from './policy';
import { prompt } from './prompt';
import { provider } from './provider';
import { rules } from './rules';
import { start } from './start';
import { workspace } from './workspace';

export const definition: RoundDefinition = {
  id: ID,
  goal,
  // A fixture: o fluxo.txt, o ticket.txt em branco e o index.html da demanda.
  start: start('kanban'),
  // Todos com o mesmo modelo; para variar por ator, decida pelo `name`.
  actors: actors(ACTOR_NAMES, () =>
    actor({
      provider: provider({ model: 'qwen3.5:4b', contextWindow: 32768 }),
      workspace: workspace(ID),
      policy: policy(['ls *', 'cat *', 'pwd', 'git status', 'git diff *']),
    }),
  ),
  // 3 ciclos: o caminho feliz (2) e uma volta.
  flow: flow({
    order: ACTOR_NAMES,
    cycles: 3,
    prompt: (name) =>
      prompt(name, {
        briefs: { solicitante: `A sua demanda: ${demand}`, dev: devTask },
      }),
  }),
  criteria: criteria({
    names: ACTOR_NAMES,
    extra: {
      // Na vez do solicitante, o tipo tem que ser uma das opções do fluxo.
      solicitante: [
        {
          file: {
            name: 'ticket.txt',
            matches: [/^tipo: (bug|feature|melhoria|debito_tecnico)\s*$/m],
          },
        },
      ],
      // Na vez do dev, a demanda implementada: o index.html tem a cor pedida.
      // Sem `changed`: numa volta do review, a cor pode já estar lá.
      dev: [{ file: { name: 'index.html', contains: ['#5f4e4e'] } }],
    },
  }),
  rules,
};
