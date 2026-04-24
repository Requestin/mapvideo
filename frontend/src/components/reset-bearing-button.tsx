import { useEditorMap } from '../hooks/use-editor-map';
import './reset-bearing-button.css';

export function ResetBearingButton(): JSX.Element {
  const { mapRef } = useEditorMap();
  return (
    <button
      type="button"
      className="reset-bearing-button"
      onClick={() => {
        const map = mapRef.current;
        if (!map) return;
        map.easeTo({ bearing: 0, pitch: 0, duration: 400 });
      }}
      aria-label="Сбросить угол обзора"
      title="Сбросить угол обзора"
    >
      ⟲
    </button>
  );
}
