import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import geocodeRouter from './routes/geocode';
import fontsRouter from './routes/fonts';
import healthRouter from './routes/health';
import userColorsRouter from './routes/user-colors';
import routeRouter from './routes/route';
import renderRouter from './routes/render';
import historyRouter from './routes/history';
import { resolveAssetsDir } from './utils/resolve-assets';

// Fonts endpoint publishes metadata (family name, URL), while the static
// middleware here serves the actual binary files. `resolveAssetsDir()`
// одинаково работает в Docker (`/app/assets`) и при локальном dev
// (`repo-root/assets`) — см. utils/resolve-assets.ts.
const ASSETS_DIR = resolveAssetsDir();

// Factory so tests can mount the app under supertest without spawning a real
// listener or triggering initAdmin side effects on import.
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind the host-level nginx: trust X-Forwarded-For from loopback only.
  // This also makes supertest-driven tests able to vary the source IP via
  // the X-Forwarded-For header so rate-limit state is scoped per-test.
  app.set('trust proxy', 'loopback');

  app.use(express.json());
  app.use(cookieParser());

  // Public static assets (fonts, icons, fire_loop frames) consumed by the SPA
  // and by the headless render worker later on. These are deliberately not
  // behind requireAuth: a PixiJS texture load cannot forward cookies to the
  // Vite dev-proxy in a predictable way, and the assets are non-sensitive.
  app.use(
    '/assets',
    express.static(ASSETS_DIR, {
      fallthrough: false,
      maxAge: '7d',
      immutable: false,
    })
  );

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/geocode', geocodeRouter);
  app.use('/api/fonts', fontsRouter);
  app.use('/api/users', userColorsRouter);
  app.use('/api/route', routeRouter);
  app.use('/api/render', renderRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/health', healthRouter);

  // Единый JSON для несуществующих путей под /api (task9).
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Не найдено' });
  });

  return app;
}
