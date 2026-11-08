/**
 * One actor of a round as a standalone agent: a button copies the
 * `new Agent({…}).run()` with the provider, workspace, policy and tools it ran
 * with, ready to paste in `agents/<nome>.ts`; the code opens below to read.
 * Only for records that kept their declaration.
 */

import { useState, type ReactNode } from 'react';

import { agentSource } from '../../../../src/rounds/declaration';
import type { RoundDeclaration } from '../../../../src/rounds/types';
import { COPIED_MS } from '../constants';
import { title } from '../format';

type Copy = 'idle' | 'copied' | 'failed';

export function ExtractAgent({
  name,
  actor,
}: {
  readonly name: string;
  readonly actor: RoundDeclaration['actors'][string];
}): ReactNode {
  const [state, setState] = useState<Copy>('idle');
  const source = agentSource(name, actor);
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
    <div className="extract-agent">
      <button type="button" className="more-rounds" onClick={copy}>
        {state === 'copied'
          ? 'Agente copiado'
          : `Extrair o ${title(name)} como agente`}
      </button>
      <span className="muted" aria-live="polite">
        {state === 'failed'
          ? 'O navegador não deixou copiar: selecione o código abaixo.'
          : `Cole em agents/${name}.ts, ajuste o prompt e rode o prettier.`}
      </span>
      <details>
        <summary>Ver o agente</summary>
        <pre>{source}</pre>
      </details>
    </div>
  );
}
