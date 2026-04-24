import { useEffect, useRef } from 'react';
import { useUserColors, MAX_CUSTOM_COLORS } from '../../state/user-colors';

// Поповер выбора цвета, вызываемый из `ColorField`. Держит три секции:
//   — «Стандартные» (пресеты из `UserColorsProvider`);
//   — «Мои цвета» (до 10 штук, per-user, сохраняются на сервере);
//   — «Свой цвет» (скрытый `<input type="color">` для свободного выбора).
// Закрывается по Escape, клику вне области или выбору цвета.

interface Props {
  /** hex `#rrggbb`, всегда нижний регистр. */
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  /** id для aria-подсказок и теста. */
  id: string;
}

export function ColorPicker(props: Props): JSX.Element {
  const { value, onChange, onClose, id } = props;
  const { presets, customColors, addColor, removeColor } = useUserColors();
  const rootRef = useRef<HTMLDivElement>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const pick = (hex: string): void => {
    onChange(hex.toLowerCase());
  };

  const canSaveCurrent =
    customColors.length < MAX_CUSTOM_COLORS && !customColors.includes(value);

  return (
    <div
      ref={rootRef}
      className="color-picker"
      role="dialog"
      aria-label="Выбор цвета"
      id={id}
    >
      <ColorSection title="Стандартные">
        {presets.map((c) => (
          <Swatch
            key={c}
            color={c}
            selected={c === value}
            onClick={() => pick(c)}
          />
        ))}
      </ColorSection>

      <ColorSection title="Мои цвета">
        {customColors.map((c) => (
          <Swatch
            key={c}
            color={c}
            selected={c === value}
            onClick={() => pick(c)}
            onDelete={() => removeColor(c)}
          />
        ))}
        {canSaveCurrent && (
          <button
            type="button"
            className="color-picker__add"
            onClick={() => addColor(value)}
            aria-label="Сохранить текущий цвет"
            title="Сохранить текущий цвет"
          >
            +
          </button>
        )}
      </ColorSection>

      <div className="color-picker__native">
        <button
          type="button"
          className="color-picker__native-btn"
          onClick={() => nativeInputRef.current?.click()}
        >
          Свой цвет…
        </button>
        <input
          ref={nativeInputRef}
          type="color"
          className="color-picker__native-input"
          value={value}
          onChange={(e) => pick(e.target.value)}
          aria-label="Выбрать произвольный цвет"
        />
      </div>
    </div>
  );
}

function ColorSection(props: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="color-picker__section">
      <h5 className="color-picker__section-title">{props.title}</h5>
      <div className="color-picker__grid">{props.children}</div>
    </section>
  );
}

function Swatch(props: {
  color: string;
  selected: boolean;
  onClick: () => void;
  onDelete?: () => void;
}): JSX.Element {
  const { color, selected, onClick, onDelete } = props;
  return (
    <div
      className={`color-picker__swatch-wrap${onDelete ? ' color-picker__swatch-wrap--removable' : ''}`}
    >
      <button
        type="button"
        className={`color-picker__swatch${selected ? ' color-picker__swatch--selected' : ''}`}
        style={{ background: color }}
        onClick={onClick}
        aria-label={color}
        title={color}
      />
      {onDelete && (
        <button
          type="button"
          className="color-picker__swatch-delete"
          onClick={(e) => {
            // Стоп на bubbling: без него клик «убить» всплыл бы на обёртку и
            // параллельно сработал бы `onClick` у основной кнопки свотча.
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Удалить цвет ${color}`}
          title="Удалить"
        >
          ×
        </button>
      )}
    </div>
  );
}
