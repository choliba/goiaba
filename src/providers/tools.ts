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
