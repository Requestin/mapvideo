import { useEffect } from 'react';
import './support-modal.css';

interface Props {
  onClose: () => void;
}

export function SupportModal({ onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="support-modal" onClick={onClose} role="dialog" aria-modal="true">
      <div className="support-modal__card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="support-modal__close"
          onClick={onClose}
          aria-label="Закрыть"
        >
          ×
        </button>
        <h2 className="support-modal__title">Тех. поддержка</h2>
        <p className="support-modal__body">
          Напишите в Telegram:{' '}
          <a
            href="https://t.me/Requestin"
            target="_blank"
            rel="noopener noreferrer"
          >
            @Requestin
          </a>
        </p>
      </div>
    </div>
  );
}
