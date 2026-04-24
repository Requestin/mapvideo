/**
 * MXF 50i: Puppeteer captures 50 progressive frames/sec; tinterlace=4
 * merges pairs of adjacent frames into 25 interlaced frames (= 50 fields/sec,
 * XDCAM 50i compatible). Input `-framerate 50` is set in render-video.ts.
 */
export function buildFfmpegOutputArgs(
  format: 'mp4' | 'mxf',
  fps: number,
  resolution: string
): string[] {
  if (format === 'mp4') {
    const encoder = process.env.FFMPEG_H264_ENCODER || 'libx264';
    if (encoder === 'h264_nvenc') {
      return [
        '-c:v', 'h264_nvenc',
        '-preset', 'p5',
        '-rc', 'vbr',
        '-cq', '21',
        '-b:v', '0',
        '-pix_fmt', 'yuv420p',
        '-s', resolution,
        '-r', String(fps),
        '-movflags', '+faststart',
      ];
    }
    const preset = fps >= 50 ? 'superfast' : 'veryfast';
    return [
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', preset,
      '-crf', '20',
      '-tune', 'zerolatency',
      '-threads', '0',
      '-s', resolution, '-r', String(fps),
      '-movflags', '+faststart',
    ];
  }
  if (fps === 50) {
    return [
      '-c:v', 'mpeg2video', '-pix_fmt', 'yuv422p',
      '-q:v', '2', '-s', resolution,
      '-vf', 'tinterlace=4,fieldorder=tff',
      '-r', '25',
      '-flags', '+ilme+ildct', '-top', '1',
      '-f', 'mxf',
    ];
  }
  return [
    '-c:v', 'mpeg2video', '-pix_fmt', 'yuv422p',
    '-q:v', '2', '-s', resolution, '-r', String(fps),
    '-f', 'mxf',
  ];
}
