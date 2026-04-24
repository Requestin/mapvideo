import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { AxiosError } from 'axios';
import { geocodeSearch, type GeocodeResult } from '../api/geocode';
import { useToast } from './toast-provider';
import './add-point-modal.css';

export interface AddPointModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { label: string; coordinates: { lng: number; lat: number }; originalText: string }) => void;
  /** Центр текущего вида — для сценария без подсказки Photon (task9). */
  getMapCenter?: () => { lng: number; lat: number } | null;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

export function AddPointModal(props: AddPointModalProps): JSX.Element | null {
  const { open, onClose, onSubmit, getMapCenter } = props;
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [label, setLabel] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [picked, setPicked] = useState<GeocodeResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setLabel('');
    setResults([]);
    setActiveIndex(0);
    setPicked(null);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (picked && picked.fullName === query) {
      setResults([]);
      setLoading(false);
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setResults([]);
      setLoading(false);
      return;
    }
    const token = Symbol('geocode');
    currentToken.current = token;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const items = await geocodeSearch(trimmed, 5);
        if (currentToken.current !== token) return;
        setResults(items);
        setActiveIndex(0);
      } catch (err) {
        if (currentToken.current !== token) return;
        setResults([]);
        if (err instanceof AxiosError && err.response?.status === 429) {
          showToast({ type: 'error', message: 'Слишком много запросов, попробуйте через минуту' });
        } else if (err instanceof AxiosError && err.response?.status === 502) {
          showToast({
            type: 'warning',
            message: 'Не удалось найти адрес. Проверьте подключение к интернету.',
          });
        } else {
          showToast({
            type: 'error',
            message: 'Не удалось найти адрес. Проверьте подключение к интернету.',
          });
        }
      } finally {
        if (currentToken.current === token) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, open, picked, showToast]);
  const currentToken = useRef<symbol | null>(null);

  const handleKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  const handleInputKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        if (results[activeIndex]) {
          e.preventDefault();
          pick(results[activeIndex]);
        }
      }
    },
    [results, activeIndex]
  );

  const pick = useCallback((r: GeocodeResult) => {
    setPicked(r);
    setLabel(r.fullName);
    setQuery(r.fullName);
    setResults([]);
  }, []);

  const mapCenter = getMapCenter?.() ?? null;
  const showLabelField = picked !== null || mapCenter !== null;
  const canSubmit = label.trim().length > 0 && (picked !== null || mapCenter !== null);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    const coords = picked?.coordinates ?? getMapCenter?.() ?? null;
    if (!coords) return;
    onSubmit({
      label: label.trim(),
      coordinates: coords,
      originalText: label.trim(),
    });
    onClose();
  }, [canSubmit, picked, getMapCenter, label, onSubmit, onClose]);

  if (!open) return null;

  return (
    <div
      className="add-point-modal__backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKey}
    >
      <div
        className="add-point-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-point-title"
      >
        <h2 id="add-point-title" className="add-point-modal__title">
          Добавить точку
        </h2>

        <label className="add-point-modal__field">
          <span>Поиск места</span>
          <input
            ref={inputRef}
            type="text"
            className="add-point-modal__input"
            placeholder="Например: Москва"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (picked && e.target.value !== picked.fullName) setPicked(null);
            }}
            onKeyDown={handleInputKey}
            autoComplete="off"
          />
        </label>

        {loading && (
          <p className="add-point-modal__status" role="status">
            Ищу…
          </p>
        )}
        {!loading && results.length > 0 && (
          <ul className="add-point-modal__results" role="listbox">
            {results.map((r, i) => (
              <li
                key={`${r.fullName}-${r.coordinates.lng}-${r.coordinates.lat}`}
                className={`add-point-modal__result${i === activeIndex ? ' add-point-modal__result--active' : ''}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r);
                }}
              >
                {r.fullName}
              </li>
            ))}
          </ul>
        )}

        {showLabelField && (
          <label className="add-point-modal__field">
            <span>
              {picked ? 'Подпись (можно изменить)' : 'Название — точка в центре карты'}
            </span>
            <input
              type="text"
              className="add-point-modal__input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
        )}

        <div className="add-point-modal__actions">
          <button type="button" className="app-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="app-button app-button--primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
