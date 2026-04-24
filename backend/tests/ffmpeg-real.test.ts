import { spawn, execSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildFfmpegOutputArgs } from '../src/render/ffmpeg-args';

const TMP = path.resolve(__dirname, 'tmp-ffmpeg');
let testPng: Buffer;

beforeAll(async () => {
  await fs.mkdir(TMP, { recursive: true });
  const pngPath = path.join(TMP, '_frame.png');
  execSync(
    `ffmpeg -y -f lavfi -i "color=red:size=16x16:duration=0.04:rate=1" -frames:v 1 -update 1 ${pngPath}`,
    { stdio: 'ignore' }
  );
  testPng = fsSync.readFileSync(pngPath);
});

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});

function pipeFrames(
  outArgs: string[],
  outPath: string,
  framerate: number,
  frameCount: number
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(
      'ffmpeg',
      ['-y', '-f', 'image2pipe', '-framerate', String(framerate), '-i', '-', ...outArgs, outPath],
      { stdio: ['pipe', 'ignore', 'pipe'] }
    );
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    for (let i = 0; i < frameCount; i++) {
      proc.stdin!.write(testPng);
    }
    proc.stdin!.end();
    proc.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

describe('FFmpeg real integration', () => {
  it('mp4 25fps — encodes 3 PNG frames into valid MP4', async () => {
    const outPath = path.join(TMP, 'test-mp4.mp4');
    const outArgs = buildFfmpegOutputArgs('mp4', 25, '16x16');
    const { code } = await pipeFrames(outArgs, outPath, 25, 3);
    expect(code).toBe(0);
    const stat = await fs.stat(outPath);
    expect(stat.size).toBeGreaterThan(100);
  });

  it('mxf 25fps progressive — produces valid MXF', async () => {
    const outPath = path.join(TMP, 'test-mxf-25.mxf');
    const outArgs = buildFfmpegOutputArgs('mxf', 25, '16x16');
    const { code } = await pipeFrames(outArgs, outPath, 25, 3);
    expect(code).toBe(0);
    const stat = await fs.stat(outPath);
    expect(stat.size).toBeGreaterThan(100);
  });

  it('mxf 50fps (50i via tinterlace) — even frame count', async () => {
    const outPath = path.join(TMP, 'test-mxf-50i.mxf');
    const outArgs = buildFfmpegOutputArgs('mxf', 50, '16x16');
    const { code, stderr } = await pipeFrames(outArgs, outPath, 50, 4);
    if (code !== 0) {
      // eslint-disable-next-line no-console
      console.error('MXF 50i stderr:', stderr.slice(-500));
    }
    expect(code).toBe(0);
    const stat = await fs.stat(outPath);
    expect(stat.size).toBeGreaterThan(100);
  });

  it('thumbnail extraction from mp4', async () => {
    const srcPath = path.join(TMP, 'test-mp4.mp4');
    const thumbPath = path.join(TMP, 'thumb.jpg');
    try {
      await fs.access(srcPath);
    } catch {
      const outArgs = buildFfmpegOutputArgs('mp4', 25, '16x16');
      await pipeFrames(outArgs, srcPath, 25, 3);
    }
    const result = await new Promise<{ code: number }>((resolve) => {
      const proc = spawn('ffmpeg', [
        '-y', '-ss', '0', '-i', srcPath, '-vframes', '1', '-vf', 'scale=320:-1', thumbPath,
      ]);
      proc.on('close', (code) => resolve({ code: code ?? 1 }));
    });
    expect(result.code).toBe(0);
    const stat = await fs.stat(thumbPath);
    expect(stat.size).toBeGreaterThan(50);
  });
});
