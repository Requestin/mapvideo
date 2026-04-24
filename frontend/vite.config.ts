import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the SPA listens on :3000 and the backend on :3001. Vite proxies
// /api calls to the backend so that cookies stay on the same origin — the
// browser won't send httpOnly cookies cross-origin even with
// withCredentials=true. In production, host nginx does the same mapping.
//
// В Docker Compose фронт и бэк — разные контейнеры: `127.0.0.1` внутри фронта
// указывает на сам фронт, не на API. См. `docker-compose.dev.yml` →
// VITE_DEV_PROXY_*.
const apiTarget = process.env.VITE_DEV_PROXY_API ?? 'http://127.0.0.1:3001';
const assetsTarget = process.env.VITE_DEV_PROXY_ASSETS ?? apiTarget;
const tilesTarget = process.env.VITE_DEV_PROXY_TILES ?? 'http://127.0.0.1:3002';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    // Иначе запросы с других контейнеров (backend → Puppeteer → http://frontend:3000)
    // получают 403 Forbidden (проверка Host в Vite 5+).
    allowedHosts: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
      },
      '/assets': {
        target: assetsTarget,
        changeOrigin: false,
      },
      // Martin: в compose сервис `martin` слушает :3000, с хоста проброшено :3002.
      '/tiles': {
        target: tilesTarget,
        changeOrigin: false,
        rewrite: (p: string): string => p.replace(/^\/tiles/, ''),
      },
    },
  },
});
