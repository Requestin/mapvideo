import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import type { Page } from 'puppeteer';
import { logger } from '../utils/logger';
import type { MapStateV1 } from './map-state';
import { buildFfmpegOutputArgs } from './ffmpeg-args';
import { issueRenderToken } from './render-tokens';
import { renderBaseVideoV2 } from './render-base-v2';

const FRONTEND_BASE = (process.env.FRONTEND_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH;
const VIDEOS_ROOT = (process.env.VIDEOS_DIR || '/data/videos').replace(/\/$/, '');
const LOCKED_RESOLUTION = '1920x1080';
const PREVIEW_RATIO = 16 / 9;

type ProgressFn = (p: number) => Promise<void>;

export async function renderVideoJob(
  jobId: string,
  userId: string,
  state: MapStateV1,
  onProgress: ProgressFn
): Promise<{ outputPath: string; thumbnailPath: string }> {
  const tStart = Date.now();
  const wStr = LOCKED_RESOLUTION.split('x')[0];
  const hStr = LOCKED_RESOLUTION.split('x')[1];
  const width = Number(wStr);
  const height = Number(hStr);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('Некорректное разрешение');
  }
  assertRenderV2Invariants(state, width, height);
  const { fps, duration, format } = state.video;
  if (fps !== 25 && fps !== 50) {
    throw new Error('Render V2 supports only 25p/50p');
  }
  if (format !== 'mp4') {
    throw new Error('Render V2 supports only MP4');
  }
  const captureFps = fps;
  const totalFrames = Math.max(1, Math.round(captureFps * duration));
  const resString = LOCKED_RESOLUTION;

  const userDir = path.join(VIDEOS_ROOT, userId);
  await fs.mkdir(userDir, { recursive: true });
  const ext = format;
  const outputPath = path.join(userDir, `${jobId}.${ext}`);

  await onProgress(5);

  const useGpu = process.env.RENDER_USE_GPU === 'true';
  const chromeArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    `--window-size=${width},${height}`,
  ];
  if (useGpu) {
    chromeArgs.push(
      '--use-gl=angle',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--enable-zero-copy'
    );
  } else {
    // Stable default for headless servers without reliable hardware WebGL.
    chromeArgs.push('--use-gl=angle', '--use-angle=swiftshader');
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH || undefined,
    args: chromeArgs,
  });

  const activeProcs = new Set<ReturnType<typeof spawn>>();

  try {
    const tPrepareEnd = Date.now();
    const outArgs = buildFfmpegOutputArgs(format, fps, resString);
    await renderBaseVideoV2({
      browser,
      jobId,
      outputPath,
      fps,
      format,
      width,
      height,
      totalFrames,
      activeProcs,
      onProgress: async (ratio) => {
        const p = 10 + Math.floor(ratio * 72);
        await onProgress(p);
      },
    });
    const tCaptureBaseEnd = Date.now();
    await onProgress(82);

    let tGeoPassEnd = tCaptureBaseEnd;
    if (hasGeoTitleEnabled(state)) {
      const overlayPath = path.join(userDir, `${jobId}.geo-overlay.mov`);
      const compositedPath = path.join(userDir, `${jobId}.geo-composited.${ext}`);
      const overlayPage = await browser.newPage();
      await overlayPage.setViewport({ width, height, deviceScaleFactor: 1 });
      const overlayToken = await issueRenderToken(jobId);
      const overlayUrl = `${FRONTEND_BASE}/geo-title-render-page?job_id=${encodeURIComponent(jobId)}&render_token=${encodeURIComponent(overlayToken)}`;
      await overlayPage.goto(overlayUrl, { waitUntil: 'load', timeout: 120000 });
      await overlayPage.waitForFunction(
        () => (globalThis as unknown as { geoTitleReady?: boolean }).geoTitleReady === true,
        { timeout: 120000 }
      );
      await renderPageToVideo({
        page: overlayPage,
        width,
        height,
        totalFrames,
        captureFps,
        applyTimeFunction: '__applyGeoTitleRenderTimeSec',
        omitBackground: true,
        ffmpegOutputArgs: ['-c:v', 'qtrle', '-pix_fmt', 'argb'],
        outputPath: overlayPath,
        onProgress: async (ratio) => {
          const p = 82 + Math.floor(ratio * 8);
          await onProgress(p);
        },
        activeProcs,
        logTag: 'ffmpeg-overlay',
      });
      await overlayPage.close().catch(() => undefined);

      await runFfmpeg(
        [
          '-y',
          '-i',
          outputPath,
          '-i',
          overlayPath,
          '-filter_complex',
          '[1:v]format=rgba[ov];[0:v][ov]overlay=0:0:format=auto:shortest=1',
          ...outArgs,
          compositedPath,
        ],
        activeProcs,
        'ffmpeg-compose'
      );
      await fs.rename(compositedPath, outputPath);
      await fs.rm(overlayPath, { force: true });
      await onProgress(94);
      tGeoPassEnd = Date.now();
    } else {
      await onProgress(85);
      tGeoPassEnd = Date.now();
    }

    const thumbnailPath = path.join(userDir, `${jobId}.jpg`);
    await runFfmpeg(
      ['-y', '-ss', '0', '-i', outputPath, '-vframes', '1', '-vf', 'scale=320:-1', thumbnailPath],
      activeProcs,
      'ffmpeg-thumb'
    );

    const tDone = Date.now();
    const tPrepare = tPrepareEnd - tStart;
    const tCaptureBase = tCaptureBaseEnd - tPrepareEnd;
    const tGeoPass = tGeoPassEnd - tCaptureBaseEnd;
    const tTotal = tDone - tStart;
    const maxAllowedMs = duration * 3000;
    logger.info(
      {
        jobId,
        fps,
        durationSec: duration,
        t_prepare_ms: tPrepare,
        t_capture_base_ms: tCaptureBase,
        t_geo_pass_ms: tGeoPass,
        t_total_processing_ms: tTotal,
        x3_limit_ms: maxAllowedMs,
      },
      'render-v2 timing'
    );
    if (tTotal > maxAllowedMs) {
      logger.warn(
        {
          jobId,
          t_total_processing_ms: tTotal,
          x3_limit_ms: maxAllowedMs,
        },
        'render-v2 exceeded x3 processing target'
      );
    }

    return { outputPath, thumbnailPath };
  } finally {
    for (const proc of activeProcs) {
      if (proc.exitCode === null) {
        proc.kill('SIGKILL');
      }
    }
    await browser.close().catch((e) => logger.warn({ err: e }, 'browser.close failed'));
  }
}

function hasGeoTitleEnabled(state: MapStateV1): boolean {
  const gt = state.geoTitle;
  if (!gt || gt.enabled !== true) return false;
  return gt.text.trim().length > 0;
}

function assertRenderV2Invariants(state: MapStateV1, width: number, height: number): void {
  if (width !== 1920 || height !== 1080) {
    throw new Error('Render V2 requires locked viewport 1920x1080');
  }
  const render = state.render;
  if (!render || render.engineVersion !== 'v2') {
    throw new Error('Render V2 requires snapshot.engineVersion=v2');
  }
  const preview = render.previewFrame;
  const ratio = preview.widthPx / preview.heightPx;
  if (!Number.isFinite(ratio) || Math.abs(ratio - PREVIEW_RATIO) > 0.02) {
    throw new Error('Preview frame must be strictly 16:9 for Render V2');
  }
}

async function renderPageToVideo(params: {
  page: Page;
  width: number;
  height: number;
  totalFrames: number;
  captureFps: number;
  applyTimeFunction: '__applyGeoTitleRenderTimeSec';
  omitBackground: boolean;
  ffmpegOutputArgs: string[];
  outputPath: string;
  onProgress: (ratio: number) => Promise<void>;
  activeProcs: Set<ReturnType<typeof spawn>>;
  logTag: string;
}): Promise<void> {
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
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

  for (let frame = 0; frame < params.totalFrames; frame++) {
    const t = frame / params.captureFps;
    await params.page.evaluate(
      (sec, fnName) => {
        const w = globalThis as unknown as Record<string, ((s: number) => void) | undefined>;
        w[fnName]?.(sec);
      },
      t,
      params.applyTimeFunction
    );
    const buf = (await params.page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: params.width, height: params.height },
      omitBackground: params.omitBackground,
    })) as Buffer;
    const ok = ffmpeg.stdin!.write(buf);
    if (!ok) await new Promise<void>((r) => ffmpeg.stdin!.once('drain', r));
    await params.onProgress((frame + 1) / params.totalFrames);
  }

  ffmpeg.stdin!.end();
  await ffmpegDone;
  params.activeProcs.delete(ffmpeg);
}

async function runFfmpeg(
  args: string[],
  activeProcs: Set<ReturnType<typeof spawn>>,
  logTag: string
): Promise<void> {
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  activeProcs.add(proc);
  proc.stderr?.on('data', (d) => {
    logger.debug({ ffmpeg: d.toString().slice(0, 220) }, logTag);
  });
  await new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
  activeProcs.delete(proc);
}
