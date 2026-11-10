/**
 * One actor of a round as a standalone agent: a button copies the
 * `new Agent({…}).run()` with the provider, workspace, policy and tools it ran
 * with, ready to paste in `agents/<nome>.ts`; another opens the code in a
 * modal, to read before copying.
 * Only for records that kept their declaration.
 */

import { useState, type ReactNode } from 'react';

import { agentSource } from '../declaration';
import type { RoundDeclaration } from '../../../../src/rounds/types';
import { COPIED_MS } from '../constants';
import { title } from '../format';
import { CodeBlock } from './CodeBlock';
import { Modal } from './Modal';

type Copy = 'idle' | 'copied' | 'failed';

export function ExtractAgent({
  name,
  actor,
}: {
  readonly name: string;
  readonly actor: RoundDeclaration['actors'][string];
}): ReactNode {
  const [state, setState] = useState<Copy>('idle');
  /** What to do with the copied agent: shown after a copy, until closed. */
  const [hinted, setHinted] = useState(false);
  const source = agentSource(name, actor);
  const copy = (): void => {
    setHinted(true);
    navigator.clipboard.writeText(source).then(
      () => {
        setState('copied');
        setTimeout(() => setState('idle'), COPIED_MS);
      },
      () => setState('failed'),
    );
  };
  const [open, setOpen] = useState(false);
  const copyButton = (
    <button
      type="button"
      className="more-rounds"
      onClick={copy}
      aria-label={`Extrair o ${title(name)} como agente`}
    >
      {state === 'copied' ? 'Agente copiado' : 'Extrair como agente'}
    </button>
  );
  const hint = hinted && (
    <p className="extract-hint" role="status">
      <span>
        {state === 'failed'
          ? 'O navegador não deixou copiar: abra o agente e selecione o código.'
          : `Cole em agents/${name}.ts e ajuste o prompt.`}
      </span>
      <button
        type="button"
        className="close"
        onClick={() => setHinted(false)}
        aria-label="Fechar o aviso"
      >
        ×
      </button>
    </p>
  );
  return (
    <footer className="extract-agent">
      {hint}
      <div className="extract-agent-actions">
        {copyButton}
        <button
          type="button"
          className="more-rounds"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`Ver o ${title(name)} como agente`}
        >
          Ver o agente
        </button>
      </div>
      <Modal
        title={`${title(name)} como agente`}
        open={open}
        onClose={() => setOpen(false)}
        wide
        actions={copyButton}
      >
        <div className="extract-agent-code">
          {hint}
          <CodeBlock code={source} label="Código do agente" />
        </div>
      </Modal>
    </footer>
  );
}
