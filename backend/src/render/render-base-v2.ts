import { spawn } from 'node:child_process';
import type { Browser } from 'puppeteer';
import { buildFfmpegOutputArgs } from './ffmpeg-args';
import { issueRenderToken } from './render-tokens';
import { capturePageToVideoViaScreencast } from './chrome-screencast';

const FRONTEND_BASE = (process.env.FRONTEND_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

interface RenderBaseV2Params {
  browser: Browser;
  jobId: string;
  outputPath: string;
  fps: 25 | 50;
  format: 'mp4';
  width: number;
  height: number;
  totalFrames: number;
  activeProcs: Set<ReturnType<typeof spawn>>;
  onProgress: (ratio: number) => Promise<void>;
}

export async function renderBaseVideoV2(params: RenderBaseV2Params): Promise<void> {
  const page = await params.browser.newPage();
  await page.setViewport({ width: params.width, height: params.height, deviceScaleFactor: 1 });

  const renderToken = await issueRenderToken(params.jobId);
  const url = `${FRONTEND_BASE}/render-page-v2?job_id=${encodeURIComponent(params.jobId)}&render_token=${encodeURIComponent(renderToken)}`;
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(
    () => (globalThis as unknown as { mapReadyV2?: boolean }).mapReadyV2 === true,
    { timeout: 120000 }
  );

  const outArgs = buildFfmpegOutputArgs(params.format, params.fps, `${params.width}x${params.height}`);
  await capturePageToVideoViaScreencast({
    page,
    captureFps: params.fps,
    totalFrames: params.totalFrames,
    applyTimeFunction: '__applyRenderTimeSecV2',
    ffmpegOutputArgs: outArgs,
    outputPath: params.outputPath,
    activeProcs: params.activeProcs,
    onProgress: params.onProgress,
    logTag: 'ffmpeg-base-v2',
  });
  await page.close().catch(() => undefined);
}
