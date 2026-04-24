import { describe, it, expect } from 'vitest';
import {
  defaultLabelSettings,
  renderLabelText,
} from '../src/state/types';

describe('renderLabelText', () => {
  it('returns the raw text when no transforms are enabled', () => {
    const s = { ...defaultLabelSettings(), truncateAtComma: false, uppercase: false };
    expect(renderLabelText('Moscow, Russia', s)).toBe('Moscow, Russia');
  });

  it('truncates at first comma when truncateAtComma is on', () => {
    const s = { ...defaultLabelSettings(), truncateAtComma: true, uppercase: false };
    expect(renderLabelText('Saint Petersburg, Russia', s)).toBe('Saint Petersburg');
  });

  it('uppercases final text', () => {
    const s = { ...defaultLabelSettings(), truncateAtComma: false, uppercase: true };
    expect(renderLabelText('Москва', s)).toBe('МОСКВА');
  });

  it('truncate happens before uppercase', () => {
    const s = { ...defaultLabelSettings(), truncateAtComma: true, uppercase: true };
    expect(renderLabelText('Казань, Россия', s)).toBe('КАЗАНЬ');
  });
});
