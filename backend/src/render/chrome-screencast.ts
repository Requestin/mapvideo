import { spawn } from 'node:child_process';
import type { Page } from 'puppeteer';
import { logger } from '../utils/logger';

type ProgressFn = (ratio: number) => Promise<void>;

interface CaptureParams {
  page: Page;
  applyTimeFunction: '__applyRenderTimeSecV2';
  captureFps: number;
  totalFrames: number;
  ffmpegOutputArgs: string[];
  outputPath: string;
  activeProcs: Set<ReturnType<typeof spawn>>;
  logTag: string;
  onProgress: ProgressFn;
}

const DEFAULT_WARMUP_FRAMES = 8;

export async function capturePageToVideoViaScreencast(params: CaptureParams): Promise<void> {
  const warmupFrames = Math.max(
    0,
    Number.parseInt(process.env.RENDER_SCREENCAST_WARMUP_FRAMES ?? '', 10) || DEFAULT_WARMUP_FRAMES
  );
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-y',
      '-f',
      'mjpeg',
      '-r',
      String(params.captureFps),
      '-i',
      '-',
      ...params.ffmpegOutputArgs,
      params.outputPath,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );
  params.activeProcs.add(ffmpeg);
  ffmpeg.stderr?.on('data', (d) => {
    logger.debug({ ffmpeg: d.toString().slice(0, 220) }, params.logTag);
  });
  const ffmpegDone = new Promise<void>((resolve, reject) => {
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
  // Prevent process crash when ffmpeg exits early and pipe writes hit EPIPE.
  ffmpeg.stdin?.on('error', (err) => {
    logger.warn({ err }, 'ffmpeg stdin error');
  });

  const cdp = await params.page.target().createCDPSession();
  await cdp.send('Page.enable');
  await params.page.evaluate(
    (sec, fnName) => {
      const w = globalThis as unknown as Record<string, ((s: number) => void) | undefined>;
      w[fnName]?.(sec);
    },
    0,
    params.applyTimeFunction
  );

  let frameIndex = 0;
  let warmupSeen = 0;
  let captureStarted = warmupFrames === 0;
  let done = false;
  let settle: ((value: void | PromiseLike<void>) => void) | null = null;
  let fail: ((reason?: unknown) => void) | null = null;
  const framesDone = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const finishOk = (): void => {
    if (done) return;
    done = true;
    settle?.();
  };
  const finishErr = (err: unknown): void => {
    if (done) return;
    done = true;
    fail?.(err);
  };

  let chain = Promise.resolve();
  cdp.on(
    'Page.screencastFrame',
    (evt: { data: string; sessionId: number }) => {
      chain = chain.then(async () => {
        if (done) {
          await cdp.send('Page.screencastFrameAck', { sessionId: evt.sessionId });
          return;
        }
        if (!captureStarted) {
          warmupSeen += 1;
          await cdp.send('Page.screencastFrameAck', { sessionId: evt.sessionId });
          if (warmupSeen >= warmupFrames) {
            // Keep warm-up at t=0 to preserve first visible frame parity
            // with preview; start encoding only after compositor settles.
            await params.page.evaluate(
              (sec, fnName) => {
                const w = globalThis as unknown as Record<
                  string,
                  ((s: number) => void) | undefined
                >;
                w[fnName]?.(sec);
              },
              0,
              params.applyTimeFunction
            );
            captureStarted = true;
          }
          return;
        }
        const img = Buffer.from(evt.data, 'base64');
        if (!ffmpeg.stdin?.write(img)) {
          await new Promise<void>((resolve) => {
            ffmpeg.stdin?.once('drain', () => resolve());
          });
        }
        frameIndex += 1;
        await params.onProgress(frameIndex / params.totalFrames);
        await cdp.send('Page.screencastFrameAck', { sessionId: evt.sessionId });

        if (frameIndex >= params.totalFrames) {
          finishOk();
          return;
        }

        const nextSec = frameIndex / params.captureFps;
        await params.page.evaluate(
          (sec, fnName) => {
            const w = globalThis as unknown as Record<string, ((s: number) => void) | undefined>;
            w[fnName]?.(sec);
          },
          nextSec,
          params.applyTimeFunction
        );
      }).catch((err) => {
        finishErr(err);
      });
    }
  );

  const timeoutMs = Math.max(120000, Math.ceil((params.totalFrames / params.captureFps) * 6000));
  const timeout = setTimeout(() => {
    finishErr(new Error('CDP screencast timeout'));
  }, timeoutMs);

  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 75,
    everyNthFrame: 1,
  });

  try {
    await framesDone;
    clearTimeout(timeout);
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    ffmpeg.stdin?.end();
    await ffmpegDone;
  } finally {
    clearTimeout(timeout);
    if (ffmpeg.exitCode === null) {
      ffmpeg.stdin?.destroy();
      ffmpeg.kill('SIGKILL');
    }
    cdp.detach().catch(() => undefined);
    params.activeProcs.delete(ffmpeg);
  }
}
