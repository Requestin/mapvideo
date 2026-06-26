import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorState } from '../state/editor-state';
import { useEditorMap } from '../hooks/use-editor-map';
import { GeoTitleSettingsPopover } from './geo-title-settings-popover';
import './bottom-toolbar.css';

export interface BottomToolbarProps {
  onAddPoint: () => void;
  onOpenVideoSettings: () => void;
  onSaveVideo: () => void;
  saveBlocked?: boolean;
  saveBlockedReason?: string;
  /** task8: блокировка тулбара и прогресс */
  renderInProgress: boolean;
  renderProgress: number;
}

// Editor action bar. Theme toggle is wired up (task4); ⚙ Видео — task7;
// 💾 Сохранить — task8. The ↗ Маршрут button only lights up
// once the user has at least one point on the map.
export function BottomToolbar({
  onAddPoint,
  onOpenVideoSettings,
  onSaveVideo,
  saveBlocked = false,
  saveBlockedReason = '',
  renderInProgress,
  renderProgress,
}: BottomToolbarProps): JSX.Element {
  const {
    elements,
    routeBuildMode,
    setRouteBuildMode,
    videoSettings,
    updateGeoTitle,
    updateVideoSettings,
  } = useEditorState();
  const { mapRef } = useEditorMap();
  const hasEnoughForRoute = elements.filter((e) => e.kind === 'point').length >= 1;
  const buildActive = routeBuildMode !== null;
  const lock = renderInProgress;
  const [durationOpen, setDurationOpen] = useState(false);
  const [breathingOpen, setBreathingOpen] = useState(videoSettings.cameraBreathing > 0);
  const [breathingDraft, setBreathingDraft] = useState(videoSettings.cameraBreathing);
  const [geoTitleOpen, setGeoTitleOpen] = useState(false);
  const breathingMemoryRef = useRef(videoSettings.cameraBreathing > 0 ? videoSettings.cameraBreathing : 25);
  const geoTitleTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setBreathingDraft(videoSettings.cameraBreathing);
  }, [videoSettings.cameraBreathing]);

  const commitBreathing = useCallback(
    (raw: number): void => {
      const next = Math.max(0, Math.min(100, Math.round(raw)));
      if (next > 0) breathingMemoryRef.current = next;
      if (next === 0) {
        const map = mapRef.current;
        if (map && videoSettings.cameraBreathingReferenceZoom != null) {
          map.setZoom(videoSettings.cameraBreathingReferenceZoom);
        }
        updateVideoSettings({
          cameraBreathing: 0,
          cameraBreathingReferenceZoom: null,
        });
        setBreathingOpen(false);
        setBreathingDraft(0);
        return;
      }
      if (next === videoSettings.cameraBreathing) return;
      updateVideoSettings({ cameraBreathing: next });
    },
    [mapRef, updateVideoSettings, videoSettings.cameraBreathing, videoSettings.cameraBreathingReferenceZoom]
  );

  const toggleBreathing = (): void => {
    if (videoSettings.cameraBreathing > 0) {
      breathingMemoryRef.current = videoSettings.cameraBreathing;
      const map = mapRef.current;
      if (map && videoSettings.cameraBreathingReferenceZoom != null) {
        map.setZoom(videoSettings.cameraBreathingReferenceZoom);
      }
      updateVideoSettings({ cameraBreathing: 0, cameraBreathingReferenceZoom: null });
      setBreathingOpen(false);
      setBreathingDraft(0);
      return;
    }
    const referenceZoom = mapRef.current?.getZoom() ?? videoSettings.cameraBreathingReferenceZoom ?? null;
    const nextStrength = Math.max(1, breathingMemoryRef.current || 25);
    updateVideoSettings({
      cameraBreathing: nextStrength,
      cameraBreathingReferenceZoom: referenceZoom,
    });
    setBreathingDraft(nextStrength);
    setBreathingOpen(true);
  };

  return (
    <footer className="bottom-toolbar">
      <button type="button" className="app-button" onClick={onAddPoint} disabled={lock}>
        + Точка
      </button>
      <button
        type="button"
        className={`app-button${buildActive ? ' app-button--primary' : ''}`}
        disabled={lock || (!hasEnoughForRoute && !buildActive)}
        onClick={() =>
          setRouteBuildMode(buildActive ? null : { waypointIds: [], routeId: null })
        }
        aria-pressed={buildActive}
        title={
          buildActive
            ? 'Завершить построение (Esc)'
            : 'Построить маршрут между точками'
        }
      >
        ↗ Маршрут
      </button>
      <div className="bottom-toolbar__group">
        <button
          type="button"
          className={`app-button${durationOpen ? ' app-button--primary' : ''}`}
          disabled={lock}
          onClick={() => setDurationOpen((v) => !v)}
          aria-pressed={durationOpen}
          title="Длительность видео"
        >
          ⏱ {videoSettings.duration}с
        </button>
        {durationOpen && (
          <label className="bottom-toolbar__slider-wrap" aria-label="Длительность видео">
            <input
              type="range"
              min={3}
              max={30}
              step={1}
              value={videoSettings.duration}
              onChange={(e) => updateVideoSettings({ duration: Number(e.target.value) })}
              disabled={lock}
            />
          </label>
        )}
      </div>
      <div className="bottom-toolbar__group">
        <button
          type="button"
          className={`app-button${videoSettings.cameraBreathing > 0 ? ' app-button--primary' : ''}`}
          disabled={lock}
          onClick={toggleBreathing}
          aria-pressed={videoSettings.cameraBreathing > 0}
          title="Дыхание камеры"
        >
          <span className="bottom-toolbar__icon" aria-hidden="true">
            📷
          </span>
          Дыхание
        </button>
        {breathingOpen && (
          <label className="bottom-toolbar__slider-wrap" aria-label="Сила дыхания камеры">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={breathingDraft}
              onChange={(e) => setBreathingDraft(Number(e.target.value))}
              onPointerUp={() => commitBreathing(breathingDraft)}
              onKeyUp={() => commitBreathing(breathingDraft)}
              onBlur={() => commitBreathing(breathingDraft)}
              disabled={lock}
            />
          </label>
        )}
      </div>
      <div className="bottom-toolbar__group">
        <button
          ref={geoTitleTriggerRef}
          type="button"
          className={`app-button${geoTitleOpen ? ' app-button--primary' : ''}`}
          disabled={lock}
          onClick={() => setGeoTitleOpen((v) => !v)}
          aria-pressed={geoTitleOpen}
          title="Настройки GEO титра"
        >
          🏠 GEO титр
        </button>
        <GeoTitleSettingsPopover
          open={geoTitleOpen}
          onClose={() => setGeoTitleOpen(false)}
          onToggleEnabled={(enabled) => {
            updateGeoTitle({ enabled });
            if (!enabled) setGeoTitleOpen(false);
          }}
          triggerRef={geoTitleTriggerRef}
        />
      </div>
      <button type="button" className="app-button" onClick={onOpenVideoSettings} disabled={lock}>
        ⚙ Видео
      </button>
      <button
        type="button"
        className="app-button bottom-toolbar__theme-toggle"
        disabled
        title="Переключить тему карты"
        tabIndex={-1}
        aria-hidden="true"
      >
        🌙 Тёмная
      </button>
      <div className="bottom-toolbar__spacer" />
      <button
        type="button"
        className="app-button app-button--primary"
        disabled={lock || saveBlocked}
        onClick={onSaveVideo}
        title={
          saveBlocked
            ? saveBlockedReason || 'Заполните обязательные поля'
            : 'Сохранить видео (рендер на сервере)'
        }
      >
        {renderInProgress ? `💾 ${renderProgress}%` : '💾 Сохранить'}
      </button>
    </footer>
  );
}
