import { useCallback, useState } from 'react';
import {
  ROUTE_ICON_SIZE_DEFAULT,
  ROUTE_ICON_SIZE_MAX,
  ROUTE_ICON_SIZE_MIN,
  type MapRoute,
  type RouteLineType,
  type RouteSettings,
  type RouteTransportIcon,
} from '../../state/types';
import { useEditorState } from '../../state/editor-state';
import { ConfirmDialog } from './confirm-dialog';
import {
  CheckboxField,
  ColorField,
  SelectField,
  SettingsSection,
  SliderField,
} from './settings-fields';

// Options kept at module scope (same reason as PointSettingsPanel — inline
// arrays break SelectField's memoisation).
const LINE_TYPE_OPTIONS: ReadonlyArray<{ value: RouteLineType; label: string }> = [
  { value: 'solid', label: 'Прямая (пульсирующая)' },
  { value: 'dashed', label: 'Пунктирная (движение А→Б)' },
];

const ICON_OPTIONS: ReadonlyArray<{ value: RouteTransportIcon; label: string }> = [
  { value: 'none', label: 'Нет' },
  { value: 'car', label: 'Автомобиль' },
  { value: 'airplane', label: 'Самолёт' },
  { value: 'helicopter', label: 'Вертолёт' },
  { value: 'ship', label: 'Корабль' },
];

// Sub-views hoisted to module scope for the same reason BlinkingControls etc.
// were in PointSettingsPanel: inline components get a fresh function identity
// on every parent render, which unmounts the <input type="range"> mid-drag.

interface SubPanelProps {
  settings: RouteSettings;
  onPatch: (patch: Partial<RouteSettings>) => void;
}

function resolveIconSize(settings: RouteSettings): number {
  const raw = settings.iconSize;
  if (!Number.isFinite(raw)) return ROUTE_ICON_SIZE_DEFAULT;
  return Math.max(ROUTE_ICON_SIZE_MIN, Math.min(ROUTE_ICON_SIZE_MAX, Math.round(raw)));
}

function LineSection({ settings, onPatch }: SubPanelProps): JSX.Element {
  return (
    <SettingsSection title="Линия">
      <SelectField<RouteLineType>
        label="Вид"
        value={settings.lineType}
        onChange={(lineType) => onPatch({ lineType })}
        options={LINE_TYPE_OPTIONS}
      />
      <ColorField
        label="Цвет"
        value={settings.color}
        onChange={(color) => onPatch({ color })}
      />
      <SliderField
        label={settings.lineType === 'dashed' ? 'Размер' : 'Толщина'}
        value={settings.thickness}
        onChange={(thickness) => onPatch({ thickness })}
        min={1}
        max={16}
        unit="px"
      />
      <CheckboxField
        label="Маршрут по дороге (OSRM)"
        checked={settings.useRoadRoute}
        onChange={(useRoadRoute) =>
          onPatch(
            useRoadRoute
              ? { useRoadRoute: true, icon: 'none', arc: false }
              : { useRoadRoute: false }
          )
        }
      />
      <SliderField
        label="Прозрачность"
        value={settings.opacity}
        onChange={(opacity) => onPatch({ opacity })}
        unit="%"
      />
      <SliderField
        label={settings.lineType === 'solid' ? 'Скорость пульсации' : 'Скорость пунктира'}
        value={settings.speed}
        onChange={(speed) => onPatch({ speed })}
        min={1}
        max={100}
      />
    </SettingsSection>
  );
}

function StrokeSection({ settings, onPatch }: SubPanelProps): JSX.Element {
  return (
    <SettingsSection title="Окантовка линии">
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
            max={8}
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
  );
}

function IconSection({ settings, onPatch }: SubPanelProps): JSX.Element {
  // Conditional controls live here so the car "road route" toggle and the
  // arc toggle for air/sea transport never appear together. SPEC mapping:
  //   car       → useRoadRoute toggle (straight vs OSRM "по дороге")
  //   airplane
  //   helicopter→ arc toggle (straight vs parabolic)
  //   ship
  //   none      → nothing extra (plain endpoint stays)
  return (
    <SettingsSection title="Иконка транспорта">
      <SelectField<RouteTransportIcon>
        label="Тип"
        value={settings.icon}
        disabled={settings.useRoadRoute}
        onChange={(icon) =>
          onPatch({
            icon,
            useRoadRoute: icon === 'car' ? settings.useRoadRoute : false,
          })
        }
        options={ICON_OPTIONS}
      />
      {settings.icon !== 'none' && !settings.useRoadRoute && (
        <SliderField
          label="Размер"
          value={resolveIconSize(settings)}
          onChange={(iconSize) => onPatch({ iconSize })}
          min={ROUTE_ICON_SIZE_MIN}
          max={ROUTE_ICON_SIZE_MAX}
          unit="px"
        />
      )}
      {settings.useRoadRoute && (
        <p className="right-sidebar__hint">
          При включенном OSRM маршрут отображается без иконки транспорта.
        </p>
      )}
      {settings.icon === 'car' && !settings.useRoadRoute && (
        <CheckboxField
          label="Дуга"
          checked={settings.arc}
          onChange={(arc) => onPatch({ arc })}
        />
      )}
      {(settings.icon === 'airplane' ||
        settings.icon === 'helicopter' ||
        settings.icon === 'ship') &&
        !settings.useRoadRoute && (
        <CheckboxField
          label="Дуга"
          checked={settings.arc}
          onChange={(arc) => onPatch({ arc })}
        />
      )}
    </SettingsSection>
  );
}

export function RouteSettingsPanel({ route }: { route: MapRoute }): JSX.Element {
  const { updateRouteSettings, resetRouteSettings, removeElement } = useEditorState();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // useCallback keyed on route.id so changes elsewhere in the store (hovered
  // element, theme) don't give onPatch a fresh identity between renders.
  const onPatch = useCallback(
    (patch: Partial<RouteSettings>) => updateRouteSettings(route.id, patch),
    [route.id, updateRouteSettings]
  );

  const s = route.settings;

  return (
    <div className="right-sidebar__settings">
      <LineSection settings={s} onPatch={onPatch} />
      <StrokeSection settings={s} onPatch={onPatch} />
      <IconSection settings={s} onPatch={onPatch} />

      <div className="right-sidebar__actions">
        <button
          type="button"
          className="app-button"
          onClick={() => resetRouteSettings(route.id)}
        >
          Сбросить настройки
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
        title="Удалить маршрут?"
        body="Точки-эндпоинты останутся на карте."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          removeElement(route.id);
        }}
      />
    </div>
  );
}
