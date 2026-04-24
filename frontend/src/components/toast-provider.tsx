import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import './toast-provider.css';

export type ToastType = 'error' | 'warning' | 'success';

type ToastItem = { id: number; type: ToastType; message: string };

const ToastContext = createContext<{
  showToast: (opts: { type: ToastType; message: string }) => void;
} | null>(null);

export function useToast(): { showToast: (opts: { type: ToastType; message: string }) => void } {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

/**
 * task9: уведомления справа снизу. Не лезет в layout редактора — `position: fixed`.
 */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  const remove = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const showToast = useCallback(
    (opts: { type: ToastType; message: string }) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { id, type: opts.type, message: opts.message }]);
      const tid = window.setTimeout(() => {
        remove(id);
      }, 6000);
      timers.current.set(id, tid);
    },
    [remove]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast toast--${t.type}`}
            role={t.type === 'error' ? 'alert' : 'status'}
          >
            <span className="toast__text">{t.message}</span>
            <button
              type="button"
              className="toast__close"
              aria-label="Закрыть"
              onClick={() => remove(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
