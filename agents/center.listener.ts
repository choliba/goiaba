import type { AgentOutput } from '../src/index';

/**
 * Every event of the agent passes here (`subscribe`), with `ts`:
 * `output.type` says what it is — input, resume, session, output, ask,
 * answer, approved, message, status, thinking, error.
 *
 * A listener only observes: calling `agent.run()` here starts the agent again
 * on every report.
 */
export function centerListener(output: AgentOutput): void {
  // console.log("centerListener >>>>>>>>>>>>>    ", output.toJSON())
}
