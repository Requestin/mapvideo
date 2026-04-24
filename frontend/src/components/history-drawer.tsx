import { useEffect } from 'react';
import './history-drawer.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

// GET /api/history — реальный эндпоинт появляется в task8. Пока панель —
// скелет с заглушкой "пусто", чтобы UI поведение было финальным и переход
// на реальные данные был только подмена содержимого списка.
export function HistoryDrawer({ open, onClose }: Props): JSX.Element {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {open && (
        <div
          className="history-drawer__backdrop"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={`history-drawer ${open ? 'history-drawer--open' : ''}`}
        aria-hidden={!open}
      >
        <header className="history-drawer__header">
          <h2 className="history-drawer__title">Моя история</h2>
          <button
            type="button"
            className="history-drawer__close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>
        <div className="history-drawer__body">
          <p className="history-drawer__empty">Вы ещё не создавали видео</p>
        </div>
      </aside>
    </>
  );
}
