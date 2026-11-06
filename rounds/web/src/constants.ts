/** Values of the rounds' pages. */

/**
 * How many tests the top of every page shows, the most recent first; the
 * others are in the "todos os testes" list. Enough to compare the last few
 * changes at a glance, few enough to fit in two rows on a laptop.
 */
export const RECENT_TESTS = 5;

/**
 * The XY chart's drawing area, in SVG units (it scales to the page's width):
 * 720 × 360 keeps a 2:1 shape that reads on a laptop and still fits a phone.
 */
export const CHART_WIDTH = 720;
export const CHART_HEIGHT = 360;

/**
 * How many divisions each axis of the XY chart aims for: about 5 keeps the
 * labels apart at phone width and still lets a value be read off the axis.
 */
export const CHART_TICKS = 5;

/**
 * How long, in milliseconds, a point's card stays after the mouse leaves the
 * point or the card: 250 ms is enough to cross the 14 px gap between them
 * and reach the card's links, and short enough to feel immediate.
 */
export const HOVER_CLOSE_MS = 250;

/**
 * How many of a test's latest rounds the index's "Rodadas" column shows
 * before "Mais (n)": three short links fit one line of that column on a
 * laptop, and the latest few are what a change is compared against.
 */
export const RECENT_ROUNDS_IN_TABLE = 3;

/**
 * How many of a test's latest rounds the bar above a test's or a round's
 * page shows before "Mais (n)": eight chips fit one line next to the test's
 * name on a laptop, and the rest are one click away in the modal.
 */
export const RECENT_ROUNDS_IN_BAR = 8;
