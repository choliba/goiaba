/** Defaults of the network boundary. */

/**
 * Where the CLIs inside the jail find the proxy: a port of the jail's own
 * loopback (`NetworkBoundary`, option `proxyPort`). 3128 is the usual port
 * of an HTTP proxy, so tools that guess find it.
 */
export const PROXY_PORT = 3128;

/**
 * Milliseconds the bridge has to show its socket before starting it failed
 * (`NetworkBoundary`, option `readyTimeoutMs`).
 */
export const READY_TIMEOUT_MS = 5000;

/** How often, in milliseconds, the bridge's socket is looked for. */
export const READY_POLL_MS = 20;

/**
 * The most an observer's copy of a connection may fall behind, in bytes
 * (`NetworkBoundary`, option `maxObservedBytes`): past it, the copy ends
 * there and the connection goes on untouched. A slow observer never holds
 * the traffic, nor fills the memory.
 */
export const MAX_OBSERVED_BYTES = 1024 * 1024;

/**
 * How often, in milliseconds, the bridge checks that Goiaba is still there,
 * to end with it. Fixed: the bridge is a process of its own, with no options.
 */
export const PARENT_CHECK_MS = 1000;

/** HTTP status for a destination that failed or is invalid. Fixed: protocol. */
export const BAD_GATEWAY = 502;

/** HTTP status for a destination the policy denies. Fixed: protocol. */
export const FORBIDDEN = 403;
