import { useEditorState } from '../state/editor-state';
import { PointSettingsPanel } from './right-sidebar/point-settings-panel';
import { LabelSettingsPanel } from './right-sidebar/label-settings-panel';
import { RouteSettingsPanel } from './right-sidebar/route-settings-panel';
import './right-sidebar.css';

// task12: renders only when an element is selected and sits as an overlay
// on top of the preview (not in a fixed grid column). When null, returns
// null — the preview reclaims the full 16:9 width. Close UX is driven
// externally: EditorWorkspace handles Esc + "click on empty map" via
// selectElement(null); the × button here is just a redundant affordance.
export function RightSidebar(): JSX.Element | null {
  const { elements, selectedElementId, selectElement } = useEditorState();
  const selected = elements.find((e) => e.id === selectedElementId) ?? null;
  if (!selected) return null;

  return (
    <aside className="right-sidebar" aria-label="Настройки элемента">
      <div className="right-sidebar__content">
        <div className="right-sidebar__head">
          <h3 className="right-sidebar__title">
            {selected.kind === 'point' && 'Настройки точки'}
            {selected.kind === 'label' && 'Настройки подписи'}
            {selected.kind === 'route' && 'Настройки маршрута'}
          </h3>
          <button
            type="button"
            className="right-sidebar__close"
            onClick={() => selectElement(null)}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        {selected.kind === 'point' && <PointSettingsPanel point={selected} />}
        {selected.kind === 'label' && <LabelSettingsPanel label={selected} />}
        {selected.kind === 'route' && <RouteSettingsPanel route={selected} />}
      </div>
    </aside>
  );
}
