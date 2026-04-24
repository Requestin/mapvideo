import { useEffect, useState } from 'react';
import type { MapLabel } from '../../state/types';
import { useEditorState } from '../../state/editor-state';
import { ConfirmDialog } from './confirm-dialog';
import {
  CheckboxField,
  ColorField,
  SettingsSection,
  SliderField,
  SelectField,
  TextField,
} from './settings-fields';
import { fetchFonts, type FontEntry } from '../../api/fonts';

// Deduplicate font families for the <select> — /api/fonts returns one entry
// per file (e.g. Montserrat-Regular.ttf, Montserrat-Bold.ttf share family
// "Montserrat"). Users pick the family; we rely on font-weight later.
function uniqueFamilies(fonts: FontEntry[]): string[] {
  const seen = new Set<string>();
  for (const f of fonts) seen.add(f.family);
  return [...seen].sort();
}

// Собираем доступные начертания для выбранного семейства. Дедуплицируем по
// `weight` (две Regular-версии из разных файлов слились бы в один пункт).
function weightsForFamily(fonts: FontEntry[], family: string): FontEntry[] {
  const variants = fonts.filter((f) => f.family === family);
  const byWeight = new Map<number, FontEntry>();
  for (const v of variants) {
    if (!byWeight.has(v.weight)) byWeight.set(v.weight, v);
  }
  return [...byWeight.values()].sort((a, b) => a.weight - b.weight);
}

export function LabelSettingsPanel({ label }: { label: MapLabel }): JSX.Element {
  const {
    updateLabelSettings,
    updateLabelText,
    resetLabelSettings,
    resetLabelLocation,
    removeElement,
  } = useEditorState();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fonts, setFonts] = useState<FontEntry[]>([]);

  // Fonts are also preloaded at editor bootstrap via loadAppFonts() — this
  // call just turns the same data into a <select> list. The backend caches
  // the directory listing in-memory so repeated calls are cheap.
  useEffect(() => {
    let cancelled = false;
    fetchFonts()
      .then((f) => {
        if (!cancelled) setFonts(f);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const s = label.settings;
  const patch = (p: Partial<typeof s>) => updateLabelSettings(label.id, p);

  const families = uniqueFamilies(fonts);
  const weightVariants = weightsForFamily(fonts, s.fontFamily);
  // Ранние подписи до task13 не хранили `fontWeight` — подставим 400, чтобы
  // селект не сбросился в пустое значение и не пересохранил NaN.
  const currentWeight = s.fontWeight ?? 400;

  const handleFamilyChange = (fontFamily: string): void => {
    const variants = weightsForFamily(fonts, fontFamily);
    // Если у нового семейства нет текущего начертания, съезжаем на ближайший
    // доступный (иначе PIXI отрендерит Regular-фолбэк и пользователь увидит
    // не то, что выбрал).
    const hasCurrent = variants.some((v) => v.weight === currentWeight);
    const nextWeight = hasCurrent
      ? currentWeight
      : (variants.find((v) => v.weight === 400) ?? variants[0])?.weight ?? 400;
    patch({ fontFamily, fontWeight: nextWeight });
  };

  return (
    <div className="right-sidebar__settings">
      <SettingsSection title="Текст">
        <TextField
          label="Подпись"
          value={label.label}
          onChange={(text) => updateLabelText(label.id, text)}
        />
        <CheckboxField
          label="Только до запятой"
          checked={s.truncateAtComma}
          onChange={(truncateAtComma) => patch({ truncateAtComma })}
        />
        <CheckboxField
          label="Только заглавные"
          checked={s.uppercase}
          onChange={(uppercase) => patch({ uppercase })}
        />
      </SettingsSection>

      <SettingsSection title="Шрифт">
        <SelectField
          label="Семейство"
          value={s.fontFamily}
          onChange={handleFamilyChange}
          options={
            families.length > 0
              ? families.map((f) => ({ value: f, label: f }))
              : [{ value: s.fontFamily, label: s.fontFamily }]
          }
        />
        <SelectField
          label="Начертание"
          value={String(currentWeight)}
          onChange={(weightStr) => patch({ fontWeight: Number(weightStr) })}
          options={
            weightVariants.length > 0
              ? weightVariants.map((v) => ({
                  value: String(v.weight),
                  label: `${v.weightLabel} (${v.weight})`,
                }))
              : [{ value: String(currentWeight), label: `Обычный (${currentWeight})` }]
          }
        />
        <SliderField
          label="Размер"
          value={s.fontSize}
          onChange={(fontSize) => patch({ fontSize })}
          min={10}
          max={64}
          unit="px"
        />
        <ColorField label="Цвет" value={s.color} onChange={(color) => patch({ color })} />
        <SliderField
          label="Прозрачность"
          value={s.opacity}
          onChange={(opacity) => patch({ opacity })}
          unit="%"
        />
      </SettingsSection>

      <SettingsSection title="Окантовка">
        <CheckboxField
          label="Включить"
          checked={s.stroke.enabled}
          onChange={(enabled) => patch({ stroke: { ...s.stroke, enabled } })}
        />
        {s.stroke.enabled && (
          <>
            <ColorField
              label="Цвет"
              value={s.stroke.color}
              onChange={(color) => patch({ stroke: { ...s.stroke, color } })}
            />
            <SliderField
              label="Толщина"
              value={s.stroke.size}
              onChange={(size) => patch({ stroke: { ...s.stroke, size } })}
              min={1}
              max={10}
              unit="px"
            />
            <SliderField
              label="Прозрачность"
              value={s.stroke.opacity}
              onChange={(opacity) => patch({ stroke: { ...s.stroke, opacity } })}
              unit="%"
            />
          </>
        )}
      </SettingsSection>

      <div className="right-sidebar__actions">
        <button
          type="button"
          className="app-button"
          onClick={() => resetLabelSettings(label.id)}
        >
          Сбросить настройки
        </button>
        <button
          type="button"
          className="app-button"
          onClick={() => resetLabelLocation(label.id)}
        >
          Сбросить местоположение
        </button>
        <button
          type="button"
          className="app-button app-button--danger"
          onClick={() => setConfirmDelete(true)}
        >
          Удалить
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить подпись?"
        body="Точка останется на карте."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          removeElement(label.id);
        }}
      />
    </div>
  );
}
