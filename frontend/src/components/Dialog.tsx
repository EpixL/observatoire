import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  id: string;
  children: ReactNode;
}

/** <dialog> natif : piège le focus, se ferme avec Échap, restitue le focus à l'élément appelant. */
export function Dialog({ open, onClose, title, id, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="dlg-head">
            <h2 id={`${id}-title`}>{title}</h2>
            <button className="btn" type="button" onClick={onClose} aria-label="Fermer">
              ✕ Fermer
            </button>
          </div>
          <div className="dlg-body">{children}</div>
        </>
      )}
    </dialog>
  );
}
