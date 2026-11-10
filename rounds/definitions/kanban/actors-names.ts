/**
 * A peça "actors-names": os atores do fluxo kanban, na ordem em que o ticket
 * anda no caminho feliz (criação → … → teste). Os nomes são os do fluxo.txt:
 * o agente se reconhece pelo PROXIMO_ATOR do ticket.
 */

export const ACTOR_NAMES = [
  'solicitante',
  'po',
  'dev',
  'revisor',
  'devops',
  'qa',
] as const;

/** Um ator do fluxo: `'po'`, `'dev'`… */
export type ActorName = (typeof ACTOR_NAMES)[number];
