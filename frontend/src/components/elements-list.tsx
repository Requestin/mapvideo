import { useEditorState } from '../state/editor-state';
import { useEditorMap } from '../hooks/use-editor-map';
import type { MapElement, MapPoint } from '../state/types';
import './elements-list.css';

// Left-side overlay list of all elements on the map. task12 turns it into
// a collapsible dropdown: a trigger button is always visible; the list
// expands on click and collapses on Esc / click-on-empty-map (handled by
// EditorWorkspace, which owns `open`). Hovering a row also highlights
// the corresponding element on the map — symmetric with hovering the
// element on the map lighting up the row (see `use-element-hover`).
export interface ElementsListProps {
  open: boolean;
  onToggle: () => void;
}

export function ElementsList({ open, onToggle }: ElementsListProps): JSX.Element {
  const {
    elements,
    selectedElementId,
    hoveredElementId,
    selectElement,
    setHoveredElement,
  } = useEditorState();
  const { isElementInView, requestFlash, resetView } = useEditorMap();

  // Clicking a row should (a) select the element and (b) draw attention
  // to it on the map. If the element is outside the current viewport we
  // first resetView (identical to the "Сбросить" button behaviour) so the
  // flash is actually visible. resetView's flyTo runs for ~600 ms; we
  // schedule the flash a bit after so the element is on-screen by then.
  const FLASH_AFTER_RESET_MS = 700;

  const handleClick = (id: string) => {
    const alreadySelected = id === selectedElementId;
    selectElement(alreadySelected ? null : id);
    if (alreadySelected) return;
    if (isElementInView(id)) {
      requestFlash(id);
    } else {
      resetView();
      window.setTimeout(() => requestFlash(id), FLASH_AFTER_RESET_MS);
    }
  };

  return (
    <aside
      className={`elements-list${open ? ' elements-list--open' : ''}`}
      aria-label="Элементы на карте"
    >
      <button
        type="button"
        className="elements-list__trigger"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span>Элементы</span>
        {elements.length > 0 && (
          <span className="elements-list__count">{elements.length}</span>
        )}
        <span className="elements-list__chevron" aria-hidden>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="elements-list__body">
          {elements.length === 0 ? (
            <p className="elements-list__empty">Пока ничего не добавлено</p>
          ) : (
            <ul className="elements-list__items">
              {elements.map((el) => {
                const active = el.id === selectedElementId;
                const hovered = el.id === hoveredElementId;
                let icon = '•';
                if (el.kind === 'point') icon = '●';
                else if (el.kind === 'label') icon = 'T';
                else if (el.kind === 'route') icon = '↗';
                const cls =
                  'elements-list__item' +
                  (active ? ' elements-list__item--active' : '') +
                  (hovered ? ' elements-list__item--hover' : '');
                // Routes resolve their display name from the *current*
                // endpoint labels so renaming a point updates the list
                // without a second reducer hop.
                const displayLabel =
                  el.kind === 'route' ? resolveRouteLabel(el, elements) : el.label;
                return (
                  <li key={el.id}>
                    <button
                      type="button"
                      className={cls}
                      onClick={() => handleClick(el.id)}
                      onMouseEnter={() => setHoveredElement(el.id)}
                      onMouseLeave={() => setHoveredElement(null)}
                    >
                      <span className="elements-list__kind">{icon}</span>
                      <span className="elements-list__label">{displayLabel}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}

// Live label for routes: "<start> → <end>". Falls back to the stored
// route.label if the reducer hasn't yet populated the endpoints we need
// (e.g. a MapRoute row survives StrictMode double-invoke before the
// point records settle into state).
function resolveRouteLabel(el: Extract<MapElement, { kind: 'route' }>, all: MapElement[]): string {
  if (el.waypoints && el.waypoints.length >= 2) {
    const labels = el.waypoints.map(
      (pointId) =>
        all.find((x): x is MapPoint => x.id === pointId && x.kind === 'point')?.label ?? 'точка'
    );
    const chain = labels.join(' → ');
    return el.end.type === 'coordinates' ? `${chain} → произвольная точка` : chain;
  }
  const startLabel =
    all.find((x): x is MapPoint => x.id === el.start.pointId && x.kind === 'point')?.label ??
    'точка';
  let endLabel = 'произвольная точка';
  if (el.end.type === 'point') {
    const endPointId = el.end.pointId;
    endLabel =
      all.find((x): x is MapPoint => x.id === endPointId && x.kind === 'point')?.label ??
      'точка';
  }
  return `${startLabel} → ${endLabel}`;
}
