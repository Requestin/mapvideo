import { describe, it, expect } from 'vitest';
import { computeResetView } from '../src/state/editor-state';
import {
  defaultPointSettings,
  defaultRouteSettings,
  type MapElement,
} from '../src/state/types';

const point = (id: string, lng: number, lat: number): MapElement => ({
  id,
  kind: 'point',
  label: id,
  coordinates: { lng, lat },
  originCoordinates: { lng, lat },
  settings: defaultPointSettings('blinking'),
  labelId: `${id}-label`,
});

const route = (id: string): MapElement => ({
  id,
  kind: 'route',
  label: id,
  start: { type: 'point', pointId: 'p-missing' },
  end: { type: 'point', pointId: 'p-missing' },
  settings: defaultRouteSettings(),
  osrmCoordinates: null,
});

describe('computeResetView', () => {
  it('returns world view when there are no points', () => {
    expect(computeResetView([])).toEqual({ kind: 'world' });
  });

  it('ignores routes with no points', () => {
    expect(computeResetView([route('r1')])).toEqual({ kind: 'world' });
  });

  it('centers on the single point', () => {
    const plan = computeResetView([point('p1', 37.618, 55.751)]);
    expect(plan).toEqual({ kind: 'center', center: [37.618, 55.751] });
  });

  it('produces bounds spanning all points', () => {
    const plan = computeResetView([
      point('p1', 37.618, 55.751),
      point('p2', 30.315, 59.939),
      point('p3', 82.921, 55.03),
    ]);
    expect(plan).toEqual({
      kind: 'bounds',
      bounds: [
        [30.315, 55.03],
        [82.921, 59.939],
      ],
    });
  });

  it('mixed points + routes only considers points for bounds', () => {
    const plan = computeResetView([
      point('p1', 10, 20),
      route('r1'),
      point('p2', 30, 40),
    ]);
    expect(plan).toEqual({
      kind: 'bounds',
      bounds: [
        [10, 20],
        [30, 40],
      ],
    });
  });
});
