import type { StyleSpecification } from 'maplibre-gl';

export type MapTheme = 'dark' | 'light';

// Martin exposes zoom-adaptive function sources (see db/sql/01-zoom-adaptive-tiles.sql).
// This keeps low zoom levels lightweight by simplifying geometry and filtering
// smaller classes server-side.
const TILE_STYLE_REV = '20260424-greenfix';

const tileSources: StyleSpecification['sources'] = {
  landuse: {
    type: 'vector',
    tiles: [`/tiles/mv_landuse/{z}/{x}/{y}?v=${TILE_STYLE_REV}`],
    minzoom: 0,
    maxzoom: 18,
  },
  water: {
    type: 'vector',
    tiles: [`/tiles/mv_water/{z}/{x}/{y}?v=${TILE_STYLE_REV}`],
    minzoom: 0,
    maxzoom: 18,
  },
  roads: {
    type: 'vector',
    tiles: [`/tiles/mv_roads/{z}/{x}/{y}?v=${TILE_STYLE_REV}`],
    minzoom: 0,
    maxzoom: 18,
  },
};

export const DARK_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: tileSources,
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#3a4658' } },
    {
      id: 'landuse-other',
      type: 'fill',
      source: 'landuse',
      'source-layer': 'landuse',
      filter: ['==', ['get', 'lu_class'], 'other'],
      paint: { 'fill-color': '#445267' },
    },
    {
      id: 'landuse-urban',
      type: 'fill',
      source: 'landuse',
      'source-layer': 'landuse',
      filter: ['==', ['get', 'lu_class'], 'urban'],
      paint: { 'fill-color': '#4f5d73' },
    },
    {
      id: 'landuse-green',
      type: 'fill',
      source: 'landuse',
      'source-layer': 'landuse',
      filter: ['==', ['get', 'lu_class'], 'green'],
      paint: {
        'fill-color': '#2e5a4d',
        'fill-opacity': 0.96,
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'water',
      'source-layer': 'water',
      paint: { 'fill-color': '#0b3f86' },
    },
    {
      id: 'roads-major',
      type: 'line',
      source: 'roads',
      'source-layer': 'roads',
      minzoom: 0,
      filter: ['match', ['get', 'highway'], ['motorway', 'trunk', 'primary'], true, false],
      paint: {
        'line-color': '#aebfda',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 2.8],
      },
    },
    {
      id: 'roads-minor',
      type: 'line',
      source: 'roads',
      'source-layer': 'roads',
      minzoom: 6,
      filter: ['match', ['get', 'highway'], ['secondary', 'tertiary', 'residential'], true, false],
      paint: { 'line-color': '#8197b8', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 12, 1.4] },
    },
  ],
};

export const LIGHT_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: tileSources,
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#f0f0ec' } },
    {
      id: 'landuse',
      type: 'fill',
      source: 'landuse',
      'source-layer': 'landuse',
      paint: { 'fill-color': '#e7e7e2' },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'water',
      'source-layer': 'water',
      paint: { 'fill-color': '#a3c0d9' },
    },
    {
      id: 'roads-major',
      type: 'line',
      source: 'roads',
      'source-layer': 'roads',
      minzoom: 0,
      filter: ['match', ['get', 'highway'], ['motorway', 'trunk', 'primary'], true, false],
      paint: {
        'line-color': '#c8c8c0',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 10, 2.5],
      },
    },
    {
      id: 'roads-minor',
      type: 'line',
      source: 'roads',
      'source-layer': 'roads',
      minzoom: 6,
      filter: ['match', ['get', 'highway'], ['secondary', 'tertiary', 'residential'], true, false],
      paint: { 'line-color': '#d7d7d0', 'line-width': 1 },
    },
  ],
};

export function styleForTheme(theme: MapTheme): StyleSpecification {
  return theme === 'dark' ? DARK_MAP_STYLE : LIGHT_MAP_STYLE;
}
