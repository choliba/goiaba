/**
 * Situations, colored the same everywhere (theme.css `.success`…): a score,
 * a badge, an alert or a card's edge.
 */

import type { ReactNode } from 'react';

/**
 * A situation, colored the same everywhere (like Bootstrap's badges):
 * good, needs attention, bad, a neutral fact, or not measured.
 */
export type Status = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** The situation of a score: good from 4, attention from 2,5, bad below. */
export const statusOf = (score: number | null): Status =>
  score === null
    ? 'neutral'
    : score >= 4
      ? 'success'
      : score >= 2.5
        ? 'warning'
        : 'danger';

/** A short text in the color of its situation. */
export function Badge({
  status,
  children,
}: {
  readonly status: Status;
  readonly children: ReactNode;
}): ReactNode {
  return <span className={`badge ${status}`}>{children}</span>;
}
