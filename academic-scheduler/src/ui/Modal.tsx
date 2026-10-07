// Accessible modal built on the native <dialog> element (focus trapping,
// Escape to close and the backdrop come from the browser).
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'narrow' | 'normal' | 'wide';
  /** id for aria-labelledby; defaults to a generated one. */
  labelId?: string;
}

let counter = 0;

export function Modal({ title, onClose, children, footer, size = 'normal', labelId }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const idRef = useRef(labelId || `modal-title-${++counter}`);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute('open', '');
      }
    }
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`modal ${size === 'normal' ? '' : size}`}
      aria-labelledby={idRef.current}
      onMouseDown={(event) => {
        // Click on the backdrop (the dialog element itself) closes.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-header">
          <h2 id={idRef.current} style={{ flex: 1 }}>
            {title}
          </h2>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </dialog>
  );
}
