/**
 * A block of TypeScript, colored once the highlighter loads (until then, and
 * if it fails, the plain text). It takes the focus when its modal opens, so
 * the arrows and Page Down scroll it.
 */

import { useEffect, useState, type ReactNode } from 'react';

export function CodeBlock({
  code,
  label,
}: {
  readonly code: string;
  /** What the code is, for screen readers. */
  readonly label: string;
}): ReactNode {
  const [html, setHtml] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setHtml(undefined);
    import('../highlight')
      .then(({ highlightTypeScript }) => highlightTypeScript(code))
      .then(
        (colored) => {
          if (current) setHtml(colored);
        },
        // Without colors the code still reads: keep the plain text.
        () => undefined,
      );
    return () => {
      current = false;
    };
  }, [code]);

  return (
    <pre className="code-block" tabIndex={0} data-autofocus aria-label={label}>
      {html === undefined ? (
        <code>{code}</code>
      ) : (
        // Shiki escapes the code; the HTML is only its spans.
        <code dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </pre>
  );
}
