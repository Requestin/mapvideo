import { describe, it, expect } from 'vitest';
import { parseDurationField } from '../src/state/types';

describe('parseDurationField (task7)', () => {
  it('clamps to 3 and 30', () => {
    expect(parseDurationField('0')).toBe(3);
    expect(parseDurationField('2')).toBe(3);
    expect(parseDurationField('3')).toBe(3);
    expect(parseDurationField('100')).toBe(30);
    expect(parseDurationField('30')).toBe(30);
  });

  it('returns null for unparseable input', () => {
    expect(parseDurationField('')).toBeNull();
    expect(parseDurationField('abc')).toBeNull();
  });

  it('takes integer prefix before first non-digit (parseInt rules)', () => {
    expect(parseDurationField('3.5')).toBe(3);
  });
});
