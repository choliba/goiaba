/**
 * The capabilities Goiaba may give an agent, in Goiaba's own words — not any
 * CLI's. A round (or whoever assembles an agent) names capabilities from this
 * list; each provider translates them into what its CLI understands, or
 * refuses the ones it does not map yet.
 *
 * The names carry their domain so they are never ambiguous: `file_search` is
 * the disk, `web_search` is the web. `file_search` is one capability, not
 * `file_glob`/`file_grep`: the point is to describe what the agent can do,
 * not to copy any CLI's menu.
 */

export const GOIABA_TOOLS = [
  'file_read',
  'file_write',
  'file_edit',
  'file_list',
  'file_search',
  'web_fetch',
  'web_search',
  'shell',
] as const;

export type GoiabaTool = (typeof GOIABA_TOOLS)[number];

/**
 * A name in a provider's `tools`: a capability of the CLI (`file_read`), or
 * a registered tool of the project, `goiaba/<nome>` (src/tools), which the
 * Goiaba serves to the CLI over MCP.
 */
export type AgentToolName = GoiabaTool | `goiaba/${string}`;

/** Whether a name is a registered tool's (`goiaba/…`), not a CLI capability. */
export const isOwnTool = (name: AgentToolName): name is `goiaba/${string}` =>
  name.startsWith('goiaba/');

/** The CLI's capabilities among `tools`: what each provider translates. */
export const cliTools = (tools: readonly AgentToolName[]): GoiabaTool[] =>
  tools.filter((name): name is GoiabaTool => !isOwnTool(name));

/** The registered tools among `tools`: what the Goiaba serves over MCP. */
export const ownTools = (tools: readonly AgentToolName[]): string[] =>
  tools.filter(isOwnTool);
