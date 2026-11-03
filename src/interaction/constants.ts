/** Defaults of the conversation. */

/**
 * Requests in a row the adapter could not ask (a pipe, a file) with
 * nothing arriving in between, before asking again is an error (option
 * `maxUnansweredRequests`). Each one is logged; up to the limit the
 * conversation goes on, since what arrives answers it anyway. Past it,
 * nobody is there to answer: the program would wait forever. 20 is far
 * above what a conversation asks between two messages.
 */
export const DEFAULT_MAX_UNANSWERED_REQUESTS = 20;
