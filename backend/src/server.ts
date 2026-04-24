import { createApp } from './app';
import { initAdmin } from './services/users-service';
import { startRenderWorker } from './render/render-queue';
import { scheduleRenderCleanup } from './cron/render-cleanup';
import { logger } from './utils/logger';

const PORT = Number(process.env.PORT) || 3001;

async function start(): Promise<void> {
  await initAdmin();
  const app = createApp();
  startRenderWorker();
  scheduleRenderCleanup();
  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Mapvideo backend listening');
  });
}

start().catch((err: unknown) => {
  logger.error({ err }, 'Server failed to start');
  process.exit(1);
});
