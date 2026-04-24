import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import './confirm-dialog.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element | null {
  const {
    open,
    title,
    body,
    confirmText = 'Удалить',
    cancelText = 'Отмена',
    variant = 'danger',
    onConfirm,
    onCancel,
  } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const dialog = (
    <div
      className="confirm-dialog__backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="confirm-dialog" role="dialog" aria-modal="true">
        <h3 className="confirm-dialog__title">{title}</h3>
        {body && <p className="confirm-dialog__body">{body}</p>}
        <div className="confirm-dialog__actions">
          <button type="button" className="app-button" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`app-button ${variant === 'danger' ? 'app-button--danger' : 'app-button--primary'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
  return createPortal(dialog, document.body);
}
