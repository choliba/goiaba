/** Values of the rounds. */

/**
 * How far, in USD, a total cost may differ from the sum of its usage records
 * and still count as equal: float rounding of a few hundred additions, far
 * below any real price (a token costs ~1e-7 USD).
 */
export const COST_TOLERANCE_USD = 1e-9;
