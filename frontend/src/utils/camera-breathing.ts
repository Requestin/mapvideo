export function breathingAmplitude(strength: number): number {
  const s = clampStrength(strength);
  return (s / 100) * 0.4;
}

export function breathingPeriodSec(strength: number): number {
  const s = clampStrength(strength);
  return 4 - (s / 100) * 2.5;
}

export function computeBreathingZoom(
  referenceZoom: number,
  strength: number,
  timeSec: number
): number {
  const period = Math.max(0.5, breathingPeriodSec(strength));
  const amplitude = breathingAmplitude(strength);
  const phase = (timeSec / period) * Math.PI * 2;
  return referenceZoom + Math.sin(phase) * amplitude;
}

function clampStrength(strength: number): number {
  return Math.max(0, Math.min(100, strength));
}
