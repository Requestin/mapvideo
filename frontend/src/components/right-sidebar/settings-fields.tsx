import { useState, type ChangeEvent, type ReactNode } from 'react';
import { ColorPicker } from './color-picker';
import './settings-fields.css';

// Shared primitives so the point/label panels stay compact. Each field owns
// its <label> so React can associate them with the control via htmlFor; we
// generate an id from the label text since the panel layout is simple.

export function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="settings-section">
      <h4 className="settings-section__title">{title}</h4>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

export function SliderField({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}): JSX.Element {
  const id = `field-${label.replace(/\s+/g, '-')}`;
  return (
    <div className="settings-field">
      <label className="settings-field__label" htmlFor={id}>
        <span>{label}</span>
        <span className="settings-field__value">
          {value}
          {unit ?? ''}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
        className="settings-field__slider"
      />
    </div>
  );
}

// task14: вместо голого `<input type="color">` — кастомная палитра с
// пресетами и «Мои цвета». API сохранён (label/value/onChange), чтобы
// потребители в `PointSettingsPanel`/`LabelSettingsPanel` не менялись.
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  const id = `field-${label.replace(/\s+/g, '-')}`;
  const popoverId = `${id}-popover`;
  const [open, setOpen] = useState(false);

  return (
    <div className="settings-field settings-field--inline">
      <label className="settings-field__label settings-field__label--inline" htmlFor={id}>
        <span>{label}</span>
      </label>
      <div className="settings-field__color-wrap">
        <button
          id={id}
          type="button"
          className="settings-field__color-trigger"
          style={{ background: value }}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          title={value}
        />
        {open && (
          <ColorPicker
            id={popoverId}
            value={value}
            onChange={(hex) => {
              onChange(hex);
              // Не закрываем поповер автоматически — пользователь часто
              // подбирает цвет, сравнивая несколько вариантов подряд. Закрыть
              // можно Esc, кликом вне или по кнопке-триггеру.
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  const id = `field-${label.replace(/\s+/g, '-')}`;
  return (
    <div className="settings-field settings-field--inline">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label className="settings-field__label settings-field__label--inline" htmlFor={id}>
        <span>{label}</span>
      </label>
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  disabled?: boolean;
}): JSX.Element {
  const id = `field-${label.replace(/\s+/g, '-')}`;
  return (
    <div className="settings-field">
      <label className="settings-field__label" htmlFor={id}>
        <span>{label}</span>
      </label>
      <select
        id={id}
        className="settings-field__select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  const id = `field-${label.replace(/\s+/g, '-')}`;
  return (
    <div className="settings-field">
      <label className="settings-field__label" htmlFor={id}>
        <span>{label}</span>
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="settings-field__text"
      />
    </div>
  );
}
