import type { AgentOutput } from '../src/index';

/**
 * Everything the agent reports passes here (`subscribe`), with `ts`:
 * `output.type` says what it is — input, resume, session, output, ask, tool,
 * tool_result, tool_error, command_decision, command, sandbox,
 * provider-noise, answer, approved, message, error.
 *
 * A listener only observes: calling `agent.run()` here starts the agent again
 * on every report.
 */
export function centerListener(output: AgentOutput): void {
  // console.log("centerListener >>>>>>>>>>>>>    ", output.toJSON())
}
