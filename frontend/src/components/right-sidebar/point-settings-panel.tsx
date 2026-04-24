import { useCallback, useState } from 'react';
import type {
  BlinkingPointSettings,
  EarthquakePointSettings,
  ExplosionPointSettings,
  FirePointSettings,
  MapPoint,
  PointAnimationKind,
  PointSettings,
} from '../../state/types';
import { useEditorState } from '../../state/editor-state';
import { ConfirmDialog } from './confirm-dialog';
import {
  CheckboxField,
  ColorField,
  SettingsSection,
  SliderField,
  SelectField,
} from './settings-fields';

const ANIMATION_OPTIONS: ReadonlyArray<{ value: PointAnimationKind; label: string }> = [
  { value: 'blinking', label: 'Мигающая точка' },
  { value: 'explosion', label: 'Взрыв' },
  { value: 'fire', label: 'Огонь' },
  { value: 'earthquake', label: 'Землетрясение' },
];

// Sub-views are declared at MODULE scope (not inside PointSettingsPanel's
// body). This is NOT a style preference — declaring them inline made React
// see a fresh `type` (function identity) on every parent render, which tore
// down and rebuilt the entire sub-tree on *every* slider `onChange`. That
// unmounted the very <input type="range"> the browser had captured for the
// mouse-drag, so users could only click the track, never drag the thumb.
// Promoting these to module-level gives each a stable type; the inputs
// reconcile in-place and drag-pan gestures survive the state update round-
// trip.

interface ControlsProps<S extends PointSettings> {
  pointId: string;
  settings: S;
  onPatch: (patch: Partial<S>) => void;
}

function BlinkingControls({
  settings,
  onPatch,
}: ControlsProps<BlinkingPointSettings>): JSX.Element {
  return (
    <>
      <SettingsSection title="Внешний вид">
        <ColorField
          label="Цвет"
          value={settings.color}
          onChange={(color) => onPatch({ color })}
        />
        <SliderField
          label="Размер"
          value={settings.size}
          onChange={(size) => onPatch({ size })}
          min={4}
          max={512}
          unit="px"
        />
        <SliderField
          label="Прозрачность"
          value={settings.opacity}
          onChange={(opacity) => onPatch({ opacity })}
          unit="%"
        />
        <SliderField
          label="Скорость"
          value={settings.speed}
          onChange={(speed) => onPatch({ speed })}
          min={1}
          max={100}
        />
      </SettingsSection>

      <SettingsSection title="Окантовка">
        <CheckboxField
          label="Включить"
          checked={settings.stroke.enabled}
          onChange={(enabled) => onPatch({ stroke: { ...settings.stroke, enabled } })}
        />
        {settings.stroke.enabled && (
          <>
            <ColorField
              label="Цвет"
              value={settings.stroke.color}
              onChange={(color) => onPatch({ stroke: { ...settings.stroke, color } })}
            />
            <SliderField
              label="Толщина"
              value={settings.stroke.size}
              onChange={(size) => onPatch({ stroke: { ...settings.stroke, size } })}
              min={1}
              max={10}
              unit="px"
            />
            <SliderField
              label="Прозрачность"
              value={settings.stroke.opacity}
              onChange={(opacity) => onPatch({ stroke: { ...settings.stroke, opacity } })}
              unit="%"
            />
          </>
        )}
      </SettingsSection>
    </>
  );
}

function ExplosionControls({
  settings,
  onPatch,
}: ControlsProps<ExplosionPointSettings>): JSX.Element {
  return (
    <SettingsSection title="Внешний вид">
      <SliderField
        label="Размер"
        value={settings.size}
        onChange={(size) => onPatch({ size })}
        min={16}
        max={512}
        unit="px"
      />
      <SliderField
        label="Разлёт"
        value={settings.spread}
        onChange={(spread) => onPatch({ spread })}
        min={0}
        max={100}
        unit="%"
      />
      <SliderField
        label="Прозрачность"
        value={settings.opacity}
        onChange={(opacity) => onPatch({ opacity })}
        unit="%"
      />
      <SliderField
        label="Скорость кругов"
        value={settings.speed}
        onChange={(speed) => onPatch({ speed })}
        min={1}
        max={100}
      />
    </SettingsSection>
  );
}

function FireControls({
  settings,
  onPatch,
}: ControlsProps<FirePointSettings>): JSX.Element {
  return (
    <SettingsSection title="Внешний вид">
      <SliderField
        label="Размер"
        value={settings.size}
        onChange={(size) => onPatch({ size })}
        min={16}
        max={512}
        unit="px"
      />
      <SliderField
        label="Прозрачность"
        value={settings.opacity}
        onChange={(opacity) => onPatch({ opacity })}
        unit="%"
      />
      <SliderField
        label="Скорость"
        value={settings.speed}
        onChange={(speed) => onPatch({ speed })}
        min={1}
        max={100}
      />
    </SettingsSection>
  );
}

function EarthquakeControls({
  settings,
  onPatch,
}: ControlsProps<EarthquakePointSettings>): JSX.Element {
  return (
    <SettingsSection title="Внешний вид">
      <SliderField
        label="Размер"
        value={settings.size}
        onChange={(size) => onPatch({ size })}
        min={16}
        max={512}
        unit="px"
      />
      <SliderField
        label="Прозрачность"
        value={settings.opacity}
        onChange={(opacity) => onPatch({ opacity })}
        unit="%"
      />
    </SettingsSection>
  );
}

export function PointSettingsPanel({ point }: { point: MapPoint }): JSX.Element {
  const {
    updatePointSettings,
    changePointAnimation,
    resetPointSettings,
    resetPointLocation,
    removeElement,
  } = useEditorState();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const s = point.settings;

  // useCallback keyed on point.id so changes to other store fields (hovered
  // element, theme, elements[]) don't give us a fresh `onPatch` identity.
  // The SliderField `<input>` itself doesn't care — it's a stable module
  // component — but downstream consumers of the props are better behaved.
  const onPatch = useCallback(
    <P extends Partial<PointSettings>>(patch: P) => updatePointSettings(point.id, patch),
    [point.id, updatePointSettings]
  );

  return (
    <div className="right-sidebar__settings">
      <SettingsSection title="Анимация">
        <SelectField<PointAnimationKind>
          label="Тип"
          value={s.kind}
          onChange={(next) => changePointAnimation(point.id, next)}
          options={ANIMATION_OPTIONS}
        />
      </SettingsSection>

      {s.kind === 'blinking' && (
        <BlinkingControls pointId={point.id} settings={s} onPatch={onPatch} />
      )}
      {s.kind === 'explosion' && (
        <ExplosionControls pointId={point.id} settings={s} onPatch={onPatch} />
      )}
      {s.kind === 'fire' && (
        <FireControls pointId={point.id} settings={s} onPatch={onPatch} />
      )}
      {s.kind === 'earthquake' && (
        <EarthquakeControls pointId={point.id} settings={s} onPatch={onPatch} />
      )}

      <div className="right-sidebar__actions">
        <button
          type="button"
          className="app-button"
          onClick={() => resetPointSettings(point.id)}
        >
          Сбросить настройки
        </button>
        <button
          type="button"
          className="app-button"
          onClick={() => resetPointLocation(point.id)}
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
        title="Удалить точку?"
        body="Подпись и связанные маршруты также будут удалены."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          removeElement(point.id);
        }}
      />
    </div>
  );
}
