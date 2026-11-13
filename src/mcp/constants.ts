/** Defaults of the agents' own tools (src/mcp). */

/**
 * The MCP server the tools are served by, and the prefix of their names in
 * the provider's `tools` and in the policy: `goiaba/consultar_ticket`.
 * Protocol, so not an option.
 */
export const TOOL_SERVER = 'goiaba';

/**
 * A tool's name: lowercase letters, digits and `_`, starting with a letter.
 * What every CLI accepts in a tool's name.
 */
export const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Milliseconds the MCP server waits for the Goiaba to answer one call (the
 * tool's `run` included) before telling the model it failed: long enough
 * for a request to an API, short enough not to hang a turn.
 */
export const TOOL_CALL_MS = 120_000;

/**
 * The version the tools' MCP server gives in the handshake (`serverInfo`):
 * the server's, not the protocol's, which the SDK negotiates with the CLI.
 */
export const TOOL_SERVER_VERSION = '2';
