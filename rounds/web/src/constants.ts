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

/**
 * The XY chart's grid densities, as multiples of `CHART_TICKS`, one option
 * each: both axes are cut in that many equal parts (5, 10 or 50). For a
 * score (0 to 5) the lines fall every 1, 0,5 and 0,1: down to tenths, the
 * precision scores are given in. Only these nest (every 0,5 is a line at
 * 0,1 steps; 0,2 or 0,25 steps miss it), so the values written on a coarser
 * grid stay written on the finer one. Every line is drawn the same; only
 * the ones with room for it get their value written.
 */
export const GRID_DENSITY = [1, 2, 10] as const;

/**
 * The room, in SVG units, the XY chart's grid values need: a line closer to
 * the next than that is drawn without its value. Vertically, 18 fits a line
 * of text. Horizontally, values sit side by side: each takes `char` per
 * character (11 px monospace, 0,6 em wide) and `x` between one and the next.
 */
export const GRID_LABEL_GAP = { y: 18, x: 14, char: 6.6 } as const;

/**
 * How long, in milliseconds, "Definição copiada" stays on the button before
 * it goes back to "Copiar definição": 2 s is time to read it.
 */
export const COPIED_MS = 2000;
