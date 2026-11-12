/**
 * The declaration a round ran with, as the file that declares it: a button
 * copies it, ready to paste in `rounds/definitions/<id>.ts`, and the code
 * opens below to read. Only for records that kept their declaration.
 */

import { useState, type ReactNode } from 'react';

import { declarationSource } from '../declaration';
import { PROJECT_TOOLS } from '../known-tools';
import type { RoundDeclaration } from '../../../../src/rounds/types';
import { COPIED_MS } from '../constants';

type Copy = 'idle' | 'copied' | 'failed';

export function CopyDeclaration({
  declaration,
}: {
  readonly declaration: RoundDeclaration;
}): ReactNode {
  const [state, setState] = useState<Copy>('idle');
  const source = declarationSource(declaration, PROJECT_TOOLS);
  const copy = (): void => {
    navigator.clipboard.writeText(source).then(
      () => {
        setState('copied');
        setTimeout(() => setState('idle'), COPIED_MS);
      },
      () => setState('failed'),
    );
  };
  return (
    <div className="copy-declaration">
      <button type="button" className="more-rounds" onClick={copy}>
        {state === 'copied' ? 'Definição copiada' : 'Copiar definição'}
      </button>
      <span className="muted" aria-live="polite">
        {state === 'failed'
          ? 'O navegador não deixou copiar: selecione o código abaixo.'
          : `Cole em rounds/definitions/${declaration.id}.ts.`}
      </span>
      <details>
        <summary>Ver a definição</summary>
        <pre>{source}</pre>
      </details>
    </div>
  );
}
