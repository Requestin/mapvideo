export const RENDER_TARGET_WIDTH_PX = 1920;

export function normalizeZoomForRenderV2(
  zoomAtPreview: number,
  previewWidthPx: number,
  targetWidthPx = RENDER_TARGET_WIDTH_PX
): number {
  if (!Number.isFinite(zoomAtPreview)) return 0;
  if (!Number.isFinite(previewWidthPx) || previewWidthPx <= 0) return zoomAtPreview;
  if (!Number.isFinite(targetWidthPx) || targetWidthPx <= 0) return zoomAtPreview;
  return zoomAtPreview + Math.log2(targetWidthPx / previewWidthPx);
}
