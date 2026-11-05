/**
 * Rounds: a benchmark of agents. A round is declared (`defineRound`: who
 * does what, from where, what is checked), runs (`runRound`), and leaves one
 * JSON record per run (`RoundRecord`), the source of the rounds' pages.
 */

export * from './types';
export {
  defineRound,
  type RoundActor,
  type RoundContext,
  type RoundDefinition,
  type RoundFlowStep,
  type RoundRule,
  type RoundStartGit,
  type RuleInput,
} from './define';
export {
  noQuestions,
  noToolCallAsText,
  readOnlyRespected,
  writableOf,
} from './rules';
export { runRound, type RunRoundOptions } from './run';
export { validateRound } from './validate';
export {
  RUBRIC_VERSION,
  scoreRound,
  type ActorScore,
  type CriterionScore,
  type RoundScore,
} from './score';
