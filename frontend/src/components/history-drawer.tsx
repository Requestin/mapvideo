import { useCallback, useEffect, useRef, useState } from 'react';
import { getHistory, type HistoryItem } from '../api/history';
import './history-drawer.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function HistoryDrawer({ open, onClose }: Props): JSX.Element {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqSeqRef = useRef(0);

  const refreshHistory = useCallback(async (): Promise<void> => {
    const seq = ++reqSeqRef.current;
    setLoading(true);
    try {
      const next = await getHistory();
      if (reqSeqRef.current !== seq) return;
      setItems(next);
      setError(null);
    } catch {
      if (reqSeqRef.current !== seq) return;
      setError('Не удалось загрузить историю');
    } finally {
      if (reqSeqRef.current === seq) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    void refreshHistory();
    const timer = window.setInterval(() => {
      void refreshHistory();
    }, 5000);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearInterval(timer);
    };
  }, [open, onClose, refreshHistory]);

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
          {loading && items.length === 0 && (
            <p className="history-drawer__empty">Загрузка истории…</p>
          )}
          {!loading && error && (
            <div className="history-drawer__error">
              <p>{error}</p>
              <button
                type="button"
                className="history-drawer__retry"
                onClick={() => void refreshHistory()}
              >
                Повторить
              </button>
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <p className="history-drawer__empty">Вы ещё не создавали видео</p>
          )}
          {items.length > 0 && (
            <ul className="history-drawer__list">
              {items.map((item) => (
                <li key={item.id} className="history-drawer__item">
                  <div className="history-drawer__thumb-wrap">
                    <img
                      src={item.thumbnailUrl}
                      alt="Миниатюра видео"
                      className="history-drawer__thumb"
                      loading="lazy"
                    />
                  </div>
                  <div className="history-drawer__meta">
                    <p className="history-drawer__name">{formatHistoryTitle(item.updatedAt)}</p>
                    <p className="history-drawer__date">{formatHistoryDate(item.updatedAt)}</p>
                    <a className="history-drawer__download" href={item.downloadUrl} download>
                      Скачать
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

function formatHistoryTitle(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Видео';
  return `Видео ${d.toLocaleDateString('ru-RU')}`;
}

function formatHistoryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Дата неизвестна';
  return d.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
