/**
 * A modal over the page: the native `<dialog>` opened with `showModal()`,
 * so the focus stays inside it, Esc closes it and, closed, the focus goes
 * back to what opened it. It also closes by its × and by a click on the
 * backdrop. The content is only mounted while open (a search inside gets
 * its focus each time).
 */

import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  title,
  open,
  onClose,
  children,
}: {
  /** Its heading, also its accessible name. */
  readonly title: string;
  readonly open: boolean;
  /** Called however it closes: ×, Esc, backdrop or a link inside. */
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) {
      element.showModal();
      // showModal focuses the first control (the ×); a field inside, such
      // as a search, is what the reader came to use.
      element.querySelector<HTMLElement>('input, textarea, select')?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="modal"
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
