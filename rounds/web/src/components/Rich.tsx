/**
 * Text as the records write it: `code` between backticks, one paragraph per
 * line, and lines starting with `- ` as a list. Never as HTML.
 */

import type { ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  return text
    .split('`')
    .map((part, index) =>
      index % 2 === 1 ? <code key={index}>{part}</code> : part,
    );
}

export function Rich({ text }: { readonly text: string }): ReactNode {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = (): void => {
    if (items.length === 0) return;
    blocks.push(
      <ul key={`ul-${String(blocks.length)}`}>
        {items.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>,
    );
    items = [];
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) {
      items.push(line.slice(2));
      continue;
    }
    flush();
    if (line.trim().length > 0) {
      blocks.push(<p key={`p-${String(blocks.length)}`}>{inline(line)}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}
