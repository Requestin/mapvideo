import { useEditorMap } from '../hooks/use-editor-map';
import './reset-view-button.css';

// Overlay bottom-right of the preview. SPEC.md: "Сбросить положение
// возвращает карту к охвату всех точек". With zero points → world view,
// one point → centered close-up, 2+ → fitBounds with padding.
export function ResetViewButton(): JSX.Element {
  const { resetView } = useEditorMap();
  return (
    <button
      type="button"
      className="reset-view-button"
      onClick={resetView}
      aria-label="Сбросить положение карты"
      title="Сбросить положение карты"
    >
      ⌂
    </button>
  );
}
