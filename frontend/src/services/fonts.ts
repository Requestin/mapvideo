import { fetchFonts, type FontEntry } from '../api/fonts';

// PixiJS `Text` renders via WebGL and only sees fonts that are already loaded
// into `document.fonts`. Without explicit @font-face + `document.fonts.load()`
// the first label rendered in Pixi falls back to a browser default and never
// refreshes. We therefore:
//   1. pull the list of TTF files from the backend;
//   2. inject a single <style> with one @font-face per file;
//   3. call document.fonts.load(...) for each family to force the browser to
//      actually fetch + decode the binary now (and not lazily on first use);
//   4. await document.fonts.ready for safety.
// Headless rendering (task8) will do the same dance in Puppeteer before
// setting window.mapReady = true.

let loadPromise: Promise<FontEntry[]> | null = null;

export function loadAppFonts(): Promise<FontEntry[]> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const fonts = await fetchFonts();
    if (fonts.length === 0) return fonts;
    injectFontFaces(fonts);
    if (typeof document === 'undefined' || !('fonts' in document)) return fonts;
    await Promise.all(
      fonts.map((f) =>
        // Браузер ленится и не грузит начертания «про запас»: без явного
        // запроса каждого веса PIXI позже увидит только дефолтный Regular.
        // Запрашиваем `<weight> 16px "<family>"`, чтобы принудительно
        // декодировать нужный файл сейчас.
        document.fonts.load(`${f.weight} 16px "${f.family}"`).catch(() => undefined)
      )
    );
    await document.fonts.ready;
    return fonts;
  })();
  return loadPromise;
}

function injectFontFaces(fonts: FontEntry[]): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('mapvideo-fonts');
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.id = 'mapvideo-fonts';
  // Важно: дескриптор `font-weight` внутри `@font-face` обязателен. Без него
  // все `Montserrat-*.ttf` регистрируются как один и тот же вариант — и
  // браузер оставляет в реестре только последний.
  style.textContent = fonts
    .map(
      (f) =>
        `@font-face { font-family: "${f.family}"; src: url("${f.url}") format("${formatFor(f.fileName)}"); font-weight: ${f.weight}; font-display: block; }`
    )
    .join('\n');
  document.head.appendChild(style);
}

function formatFor(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ttf':
      return 'truetype';
    case 'otf':
      return 'opentype';
    case 'woff':
      return 'woff';
    case 'woff2':
      return 'woff2';
    default:
      return 'truetype';
  }
}

// Test hook — do not use in app code.
export function __resetFontsForTests(): void {
  loadPromise = null;
  if (typeof document !== 'undefined') {
    document.getElementById('mapvideo-fonts')?.remove();
  }
}
