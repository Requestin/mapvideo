import { isMapStateV1 } from '../src/render/map-state';

function validState(): unknown {
  return {
    version: '1.0',
    map: {
      center: { lng: 37.62, lat: 55.75 },
      zoom: 9,
      bearing: 0,
      pitch: 0,
      theme: 'dark',
    },
    video: {
      resolution: '1920x1080',
      fps: 25,
      format: 'mp4',
      duration: 10,
      theme: 'dark',
      cameraBreathing: 25,
      cameraBreathingReferenceZoom: 9,
    },
    render: {
      engineVersion: 'v2',
      previewFrame: { widthPx: 1600, heightPx: 900 },
      devicePixelRatio: 1,
      pageZoom: 1,
    },
    elements: [],
  };
}

describe('MapStateV1 validator for Render V2', () => {
  it('accepts valid V2 state', () => {
    expect(isMapStateV1(validState())).toBe(true);
  });

  it('rejects payload without render snapshot', () => {
    const state = validState() as Record<string, unknown>;
    delete state.render;
    expect(isMapStateV1(state)).toBe(false);
  });

  it('rejects disabled presets (fps/format)', () => {
    const fps30 = validState() as Record<string, unknown>;
    (fps30.video as { fps: number }).fps = 30;
    expect(isMapStateV1(fps30)).toBe(false);

    const mxf = validState() as Record<string, unknown>;
    (mxf.video as { format: string }).format = 'mxf';
    expect(isMapStateV1(mxf)).toBe(false);
  });
});
