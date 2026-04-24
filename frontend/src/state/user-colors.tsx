import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getMyColors, saveMyColors } from '../api/user-colors';

// 10 стандартных цветов — фиксированный пресет, общий для всех пользователей.
// Подбирал под новостной UI: чистые чёрный/белый, три «тревожных» тона
// (красный/оранжевый/жёлтый), три «нейтральных» (зелёный/синий/серый) и два
// бренд-ярких (фиолетовый/розовый). Если надо будет подмешать кастомизацию
// для канала — список вынесем в конфиг.
export const PRESET_COLORS: readonly string[] = [
  '#ffffff',
  '#000000',
  '#ff4444',
  '#ff9933',
  '#ffcc00',
  '#44bb44',
  '#3d8bff',
  '#9c27b0',
  '#ff66b2',
  '#888888',
];

export const MAX_CUSTOM_COLORS = 10;

interface UserColorsValue {
  presets: readonly string[];
  customColors: string[];
  /** Добавляет цвет в голову списка (MRU-порядок). Дубликаты игнорируются,
   *  при переполнении «выталкивается» самый старый. */
  addColor: (hex: string) => void;
  removeColor: (hex: string) => void;
  /** true — пока идёт первичная загрузка. Компоненты могут не ждать; попап
   *  рендерится и без кастомной секции, если список ещё пуст. */
  loading: boolean;
}

const UserColorsContext = createContext<UserColorsValue | undefined>(undefined);

function normalize(hex: string): string | null {
  const trimmed = hex.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : null;
}

export function UserColorsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [customColors, setCustomColors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Запоминаем последний успешно сохранённый снапшот, чтобы оптимистичный
  // PUT умел откатиться при сетевой ошибке, не обрушив пользовательский UI.
  const lastPersistedRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    getMyColors()
      .then((colors) => {
        if (cancelled) return;
        setCustomColors(colors);
        lastPersistedRef.current = colors;
      })
      .catch(() => {
        // 401 на редакторе не случается (мы уже за ProtectedRoute), но сервер
        // может быть временно недоступен — остаёмся с пустым списком.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Единый «драйвер» мутаций: считаем следующий список, ставим его локально,
  // пушим на сервер. На ошибке возвращаем предыдущий снапшот.
  const commit = useCallback((nextComputed: string[]): void => {
    setCustomColors(nextComputed);
    saveMyColors(nextComputed)
      .then((persisted) => {
        // Сервер может дополнительно нормализовать (lowercase/дедуп) — его
        // версия каноническая.
        setCustomColors(persisted);
        lastPersistedRef.current = persisted;
      })
      .catch(() => {
        setCustomColors(lastPersistedRef.current);
      });
  }, []);

  const addColor = useCallback(
    (hex: string) => {
      const normalized = normalize(hex);
      if (!normalized) return;
      setCustomColors((prev) => {
        // MRU: если цвет уже есть — поднимаем его в начало без дублирования.
        const without = prev.filter((c) => c !== normalized);
        const next = [normalized, ...without].slice(0, MAX_CUSTOM_COLORS);
        // Никаких изменений — избегаем лишнего PUT.
        if (arraysEqual(prev, next)) return prev;
        queueMicrotask(() => commit(next));
        return next;
      });
    },
    [commit]
  );

  const removeColor = useCallback(
    (hex: string) => {
      const normalized = normalize(hex);
      if (!normalized) return;
      setCustomColors((prev) => {
        if (!prev.includes(normalized)) return prev;
        const next = prev.filter((c) => c !== normalized);
        queueMicrotask(() => commit(next));
        return next;
      });
    },
    [commit]
  );

  const value = useMemo<UserColorsValue>(
    () => ({ presets: PRESET_COLORS, customColors, addColor, removeColor, loading }),
    [customColors, addColor, removeColor, loading]
  );

  return <UserColorsContext.Provider value={value}>{children}</UserColorsContext.Provider>;
}

// Хук специально НЕ бросает, когда провайдера нет (например в unit-тестах на
// отдельную панель): падать из-за отсутствия палитры — это ложное срабатывание,
// а функционал ColorField в такой изоляции достаточно read-only. В production
// рендере провайдер стоит в `EditorPage`, так что пользователь всегда получит
// полноценную историю.
const NOOP_VALUE: UserColorsValue = Object.freeze({
  presets: PRESET_COLORS,
  customColors: [],
  addColor: () => undefined,
  removeColor: () => undefined,
  loading: false,
});

export function useUserColors(): UserColorsValue {
  return useContext(UserColorsContext) ?? NOOP_VALUE;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
