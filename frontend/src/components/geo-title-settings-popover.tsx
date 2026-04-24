import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import { fetchFonts, type FontEntry } from '../api/fonts';
import { geocodeSearch, type GeocodeResult } from '../api/geocode';
import { useEditorState } from '../state/editor-state';
import { useToast } from './toast-provider';
import './geo-title-settings-popover.css';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

function uniqueFamilies(fonts: FontEntry[]): string[] {
  const seen = new Set<string>();
  for (const f of fonts) seen.add(f.family);
  return [...seen].sort();
}

function weightsForFamily(fonts: FontEntry[], family: string): FontEntry[] {
  const variants = fonts.filter((f) => f.family === family);
  const byWeight = new Map<number, FontEntry>();
  for (const v of variants) {
    if (!byWeight.has(v.weight)) byWeight.set(v.weight, v);
  }
  return [...byWeight.values()].sort((a, b) => a.weight - b.weight);
}

export interface GeoTitleSettingsPopoverProps {
  open: boolean;
  onClose: () => void;
}

export function GeoTitleSettingsPopover({
  open,
  onClose,
}: GeoTitleSettingsPopoverProps): JSX.Element | null {
  const { geoTitle, updateGeoTitle } = useEditorState();
  const { showToast } = useToast();
  const [fonts, setFonts] = useState<FontEntry[]>([]);
  const [query, setQuery] = useState(geoTitle.originalText);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef<symbol | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchFonts()
      .then((next) => {
        if (!cancelled) setFonts(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery(geoTitle.originalText);
    setResults([]);
    setActiveIndex(0);
  }, [geoTitle.originalText, open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (!popoverRef.current?.contains(target)) onClose();
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setResults([]);
      setLoading(false);
      return;
    }
    const token = Symbol('geo-title-geocode');
    tokenRef.current = token;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const items = await geocodeSearch(trimmed, 5);
        if (tokenRef.current !== token) return;
        setResults(items);
        setActiveIndex(0);
      } catch (err) {
        if (tokenRef.current !== token) return;
        setResults([]);
        if (err instanceof AxiosError && err.response?.status === 429) {
          showToast({ type: 'error', message: 'Слишком много запросов, попробуйте через минуту.' });
        } else {
          showToast({
            type: 'warning',
            message: 'Не удалось получить подсказки для GEO титра.',
          });
        }
      } finally {
        if (tokenRef.current === token) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query, showToast]);

  const families = useMemo(() => uniqueFamilies(fonts), [fonts]);
  const variants = useMemo(
    () => weightsForFamily(fonts, geoTitle.fontFamily),
    [fonts, geoTitle.fontFamily]
  );

  const applyRawText = useCallback(
    (raw: string) => {
      updateGeoTitle({ originalText: raw });
    },
    [updateGeoTitle]
  );

  const pickSuggestion = useCallback(
    (r: GeocodeResult) => {
      setQuery(r.fullName);
      setResults([]);
      applyRawText(r.fullName);
    },
    [applyRawText]
  );

  const onFamilyChange = useCallback(
    (family: string) => {
      const familyVariants = weightsForFamily(fonts, family);
      const hasCurrent = familyVariants.some((v) => v.weight === geoTitle.fontWeight);
      const fallback =
        familyVariants.find((v) => v.weight === 700)?.weight ??
        familyVariants.find((v) => v.weight === 400)?.weight ??
        familyVariants[0]?.weight ??
        700;
      updateGeoTitle({
        fontFamily: family,
        fontWeight: hasCurrent ? geoTitle.fontWeight : fallback,
      });
    },
    [fonts, geoTitle.fontWeight, updateGeoTitle]
  );

  if (!open) return null;

  return (
    <div
      className="geo-title-settings-popover"
      ref={popoverRef}
      role="dialog"
      aria-label="Настройки GEO титра"
    >
      <p className="geo-title-settings-popover__title">ГЕО титр</p>

      <label className="geo-title-settings-popover__field">
        <span>Локация</span>
        <input
          type="text"
          value={query}
          placeholder="Например: Москва, Россия"
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            applyRawText(next);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && results[activeIndex]) {
              e.preventDefault();
              pickSuggestion(results[activeIndex]);
            }
          }}
        />
      </label>

      {loading && <p className="geo-title-settings-popover__status">Ищу…</p>}
      {!loading && results.length > 0 && (
        <ul className="geo-title-settings-popover__suggestions" role="listbox">
          {results.map((r, i) => (
            <li
              key={`${r.fullName}-${r.coordinates.lng}-${r.coordinates.lat}`}
              className={`geo-title-settings-popover__suggestion${
                i === activeIndex ? ' geo-title-settings-popover__suggestion--active' : ''
              }`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                pickSuggestion(r);
              }}
            >
              {r.fullName}
            </li>
          ))}
        </ul>
      )}

      <label className="geo-title-settings-popover__checkbox">
        <input
          type="checkbox"
          checked={geoTitle.truncateAtComma}
          onChange={(e) => updateGeoTitle({ truncateAtComma: e.target.checked })}
        />
        Только до запятой
      </label>
      <label className="geo-title-settings-popover__checkbox">
        <input
          type="checkbox"
          checked={geoTitle.uppercase}
          onChange={(e) => updateGeoTitle({ uppercase: e.target.checked })}
        />
        Только заглавные
      </label>

      <label className="geo-title-settings-popover__field">
        <span>Семейство</span>
        <select value={geoTitle.fontFamily} onChange={(e) => onFamilyChange(e.target.value)}>
          {(families.length > 0 ? families : [geoTitle.fontFamily]).map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </select>
      </label>
      <label className="geo-title-settings-popover__field">
        <span>Начертание</span>
        <select
          value={String(geoTitle.fontWeight)}
          onChange={(e) => updateGeoTitle({ fontWeight: Number(e.target.value) })}
        >
          {(variants.length > 0
            ? variants.map((v) => ({
                value: String(v.weight),
                label: `${v.weightLabel} (${v.weight})`,
              }))
            : [{ value: String(geoTitle.fontWeight), label: `Weight ${geoTitle.fontWeight}` }]
          ).map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      <p className="geo-title-settings-popover__preview">
        {geoTitle.text || 'Введите текст GEO титра'}
      </p>
    </div>
  );
}
