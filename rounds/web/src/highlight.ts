/**
 * Colors TypeScript the way VS Code does (Shiki, with its grammar and the
 * GitHub themes). The only module of the pages that knows Shiki; loaded on
 * demand (`import('./highlight')`), so the pages do not wait for it.
 */

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/** One highlighter for every block: building it loads the grammar. */
let highlighter: Promise<HighlighterCore> | undefined;

const load = (): Promise<HighlighterCore> =>
  (highlighter ??= createHighlighterCore({
    themes: [
      import('shiki/themes/github-light.mjs'),
      import('shiki/themes/github-dark.mjs'),
    ],
    langs: [import('shiki/langs/typescript.mjs')],
    // The JavaScript engine: no WebAssembly to fetch.
    engine: createJavaScriptRegexEngine(),
  }));

/**
 * The lines of `code` as HTML, each token a `<span>` carrying both themes'
 * colors (`--shiki-light`, `--shiki-dark`); theme.css picks one. Only what
 * goes inside the `<code>`: the block around it is the caller's.
 */
export async function highlightTypeScript(code: string): Promise<string> {
  const html = (await load()).codeToHtml(code, {
    lang: 'typescript',
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
  return /<code>([\s\S]*)<\/code>/.exec(html)?.[1] ?? '';
}
