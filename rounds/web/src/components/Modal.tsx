/**
 * A modal over the page: the native `<dialog>` opened with `showModal()`,
 * so the focus stays inside it, Esc closes it and, closed, the focus goes
 * back to what opened it. It also closes by its × and by a click on the
 * backdrop. The content is only mounted while open (a search inside, or
 * what is marked `data-autofocus`, gets its focus each time). `wide` is for
 * long content, such as code.
 */

import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  title,
  open,
  onClose,
  wide = false,
  actions,
  children,
}: {
  /** Its heading, also its accessible name. */
  readonly title: string;
  readonly open: boolean;
  /** Called however it closes: ×, Esc, backdrop or a link inside. */
  readonly onClose: () => void;
  /** Wider and taller, for long content. */
  readonly wide?: boolean;
  /** Buttons in the heading, before the ×: the modal's own actions. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) {
      element.showModal();
      // showModal focuses the first control (the ×); a field inside, such
      // as a search, or what is marked to scroll by keyboard (code), is what
      // the reader came to use.
      element
        .querySelector<HTMLElement>('input, textarea, select, [data-autofocus]')
        ?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={wide ? 'modal wide' : 'modal'}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop (the dialog itself, outside its body) closes it.
        if (event.target === dialog.current) dialog.current.close();
      }}
    >
      {open && (
        <div className="dialog-body">
          <div className="dialog-head">
            <h2>{title}</h2>
            {actions !== undefined && (
              <div className="dialog-actions">{actions}</div>
            )}
            <button
              type="button"
              className="close"
              onClick={() => dialog.current?.close()}
              aria-label="Fechar"
            >
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
