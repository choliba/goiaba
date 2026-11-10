/**
 * A list of tool calls under a heading, each opening to its detail, with one
 * button beside the heading when there is more than one: "Expandir todas"
 * while any is closed, "Recolher todas" once all are open (opened one by one
 * or at once).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { ToolRecord } from '../../../../src/rounds/types';
import { ToolCall } from './ToolCall';

export function ToolList({
  heading,
  tools,
}: {
  /** The section's heading: `Ferramentas`, with a badge if any. */
  readonly heading: ReactNode;
  readonly tools: readonly ToolRecord[];
}): ReactNode {
  const list = useRef<HTMLOListElement>(null);
  /** Whether every call is open: what the button does next depends on it. */
  const [allOpen, setAllOpen] = useState(false);
  /** Each call's own details: not the ones nested inside its detail. */
  const calls = (): readonly HTMLDetailsElement[] => [
    ...(list.current?.querySelectorAll<HTMLDetailsElement>(
      ':scope > li > details',
    ) ?? []),
  ];

  // A call opened or closed by hand changes the button too. `toggle` does
  // not bubble: listened to on the way down.
  useEffect(() => {
    const element = list.current;
    if (element === null) return undefined;
    const update = (): void => {
      setAllOpen(calls().every((details) => details.open));
    };
    element.addEventListener('toggle', update, true);
    return () => element.removeEventListener('toggle', update, true);
  }, []);

  /** Opens (or closes) every call of the list at once. */
  const setAll = (open: boolean): void => {
    for (const details of calls()) details.open = open;
    setAllOpen(open);
  };
  return (
    <section>
      <div className="tool-list-head">
        <h3>{heading}</h3>
        {tools.length > 1 && (
          <button
            type="button"
            className="more-rounds"
            aria-expanded={allOpen}
            onClick={() => setAll(!allOpen)}
          >
            {allOpen ? 'Recolher todas' : 'Expandir todas'}
          </button>
        )}
      </div>
      <ol className="tools" ref={list}>
        {tools.map((tool, i) => (
          <li key={i} className={tool.outcome}>
            <ToolCall tool={tool} />
          </li>
        ))}
      </ol>
    </section>
  );
}
