import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  ACTIVE_VIDEO_FORMAT,
  ACTIVE_VIDEO_FPS,
  DEFAULT_VIDEO_SETTINGS,
  LOCKED_VIDEO_RESOLUTION,
  type VideoFps,
  type VideoFormat,
  type VideoResolution,
  type VideoSettings,
} from '../state/types';
import { useEditorState } from '../state/editor-state';
import { SettingsSection } from './right-sidebar/settings-fields';
import './video-settings-modal.css';

export interface VideoSettingsModalProps {
  open: boolean;
  /** Revert map theme to snapshot + close (× / overlay / Esc / «Отмена»). */
  onCancel: () => void;
  /** Commit and close. */
  onSave: (next: VideoSettings) => void;
}

export function VideoSettingsModal({ open, onCancel, onSave }: VideoSettingsModalProps): null | JSX.Element {
  const { videoSettings } = useEditorState();
  const formId = useId();

  const [draft, setDraft] = useState<VideoSettings>(videoSettings);

  // Fresh draft + duration text whenever the dialog opens.
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      const v: VideoSettings = { ...videoSettings, resolution: LOCKED_VIDEO_RESOLUTION };
      setDraft(v);
    }
    prevOpen.current = open;
  }, [open, videoSettings]);

  const handleSave = useCallback(() => {
    onSave({ ...draft, resolution: LOCKED_VIDEO_RESOLUTION });
  }, [draft, onSave]);

  const handleReset = useCallback(() => {
    const d: VideoSettings = {
      ...draft,
      resolution: DEFAULT_VIDEO_SETTINGS.resolution,
      fps: DEFAULT_VIDEO_SETTINGS.fps,
      format: DEFAULT_VIDEO_SETTINGS.format,
    };
    setDraft(d);
  }, [draft]);

  if (!open) return null;

  return (
    <div
      className="video-settings-modal__backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="video-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
      >
        <header className="video-settings-modal__head">
          <h2 id={`${formId}-title`} className="video-settings-modal__title">
            Настройки видео
          </h2>
          <button
            type="button"
            className="video-settings-modal__close"
            onClick={onCancel}
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>

        <div className="video-settings-modal__scroller">
          <SettingsSection title="Разрешение">
            <p className="video-settings-modal__hint">
              Временно доступен только рендер в Full HD (1920×1080).
            </p>
            <RadioGroup
              name={`${formId}-res`}
              options={
                [
                  { value: '1920x1080' as const, label: '1920×1080 (FHD)' },
                  { value: '3840x2160' as const, label: '3840×2160 (4K UHD)' },
                ] as { value: VideoResolution; label: string }[]
              }
              value={LOCKED_VIDEO_RESOLUTION}
              disabled
              onChange={() => {
                // Resolution is temporarily locked to FHD.
              }}
            />
          </SettingsSection>

          <SettingsSection title="Частота кадров (FPS)">
            <p className="video-settings-modal__hint">
              Сейчас доступны только 25p и 50p. Остальные режимы появятся позже.
            </p>
            <RadioGroup
              name={`${formId}-fps`}
              options={
                [
                  { value: 25 as const, label: '25p' },
                  { value: 30 as const, label: '30p (доступно позже)', disabled: true },
                  { value: 50 as const, label: '50p' },
                  { value: 60 as const, label: '60p (доступно позже)', disabled: true },
                ] as { value: VideoFps; label: string; disabled?: boolean }[]
              }
              value={draft.fps}
              onChange={(v) => {
                if (!ACTIVE_VIDEO_FPS.includes(v)) return;
                setDraft((d) => ({ ...d, fps: v }));
              }}
            />
            <p className="video-settings-modal__hint">50i станет доступно позже.</p>
          </SettingsSection>

          <SettingsSection title="Контейнер">
            <RadioGroup
              name={`${formId}-fmt`}
              options={
                [
                  { value: 'mp4' as const, label: 'MP4' },
                  { value: 'mxf' as const, label: 'MXF (доступно позже)', disabled: true },
                ] as { value: VideoFormat; label: string; disabled?: boolean }[]
              }
              value={draft.format}
              onChange={(v) => {
                if (v !== ACTIVE_VIDEO_FORMAT) return;
                setDraft((d) => ({ ...d, format: v }));
              }}
            />
          </SettingsSection>

        </div>

        <footer className="video-settings-modal__footer">
          <button type="button" className="app-button" onClick={handleReset}>
            Сбросить настройки
          </button>
          <div className="video-settings-modal__footer-right">
            <button type="button" className="app-button" onClick={onCancel}>
              Отмена
            </button>
            <button type="button" className="app-button app-button--primary" onClick={handleSave}>
              Сохранить
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function RadioGroup<T extends string | number>({
  name,
  value,
  onChange,
  disabled = false,
  options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  options: { value: T; label: string; disabled?: boolean }[];
}): JSX.Element {
  return (
    <div className="video-settings-modal__radio-group" role="group">
      {options.map((o) => {
        const id = `${name}-${o.value}`;
        return (
          <label key={String(o.value)} className="video-settings-modal__radio" htmlFor={id}>
            <input
              id={id}
              type="radio"
              name={name}
              value={String(o.value)}
              disabled={disabled || o.disabled}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
