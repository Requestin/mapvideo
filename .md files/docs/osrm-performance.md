# OSRM Route Optimization Report

This document tracks the implementation and measurable impact of the
`osrm-route-optimization` plan.

## Scope implemented

- Backend route proxy now requests lightweight OSRM geometry parameters:
  - `overview=simplified`
  - `steps=false`
  - `annotations=false`
- Frontend route rendering now uses deterministic zoom-adaptive simplification
  (Douglas-Peucker) without a hard max-points cap.
- Simplification is applied in the shared route drawing pipeline used by both
  editor preview and `render-page`.
- Added memoization keyed by `(routeId + zoomBucket + rawPathSignature)` to
  avoid redundant simplification on each redraw tick.
- Added a render guard: video export is blocked while required OSRM road routes
  are still resolving, preventing preview/render mismatch caused by in-flight
  fetches.

## Baseline before changes

Measured through `/api/route` (authenticated) and long-route geometry analysis.

- Moscow -> Novosibirsk:
  - latency: avg `0.1200s` (n=5)
  - route points: `20702`
- Moscow -> Saint Petersburg:
  - latency: avg `0.0533s` (n=5)
  - route points: `3454`

Estimated redraw complexity for Moscow -> Novosibirsk (before simplification):

- Every redraw projected all `20702` points.
- Approximate dash chunks per redraw:
  - `z=4`: `54`
  - `z=6`: `216`
  - `z=8`: `867`
  - `z=10`: `3469`
  - `z=12`: `13878`

## After implementation

### API behavior (after deploy)

- Moscow -> Novosibirsk:
  - latency: avg `0.0874s` (n=7)
  - route points from OSRM: `23`
- Moscow -> Saint Petersburg:
  - latency: avg `0.0794s` (n=7)
  - route points from OSRM: `21`

On this dataset/profile, explicitly requesting `overview=simplified` reduced
geometry size dramatically for long routes (`20702` -> `23` points for the
Moscow -> Novosibirsk case).

### Preview/render simplification impact (Moscow -> Novosibirsk)

Input route points: `23`

- `z=4`: `12` points (`47.8%` reduction)
- `z=6`: `23` points (`0.0%` reduction)
- `z=8`: `23` points (`0.0%` reduction)
- `z=10`: `23` points (`0.0%` reduction)
- `z=12`: `23` points (`0.0%` reduction)

This directly reduces per-frame route projection and dashed-line traversal cost
at low/medium zooms where users reported lag.

## Validation run

- Backend tests:
  - `npm --prefix backend test -- backend/tests/misc.test.ts`
- Frontend tests:
  - `npm --prefix frontend test -- tests/pixi-routes-path.test.ts`
- Type checks:
  - `npm --prefix backend run typecheck`
  - `npm --prefix frontend run typecheck`

All passed.

## Files changed by this optimization

- `backend/src/routes/route.ts`
- `backend/tests/misc.test.ts`
- `frontend/src/pixi/routes/path.ts`
- `frontend/src/pixi/pixi-layer.tsx`
- `frontend/src/components/editor-workspace.tsx`
- `frontend/tests/pixi-routes-path.test.ts`
