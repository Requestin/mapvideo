import { describe, it, expect, beforeEach } from 'vitest';
import { readCookie } from '../src/utils/cookies';

describe('readCookie', () => {
  beforeEach(() => {
    // jsdom's document.cookie is writable but additive; clear by setting
    // all existing keys to empty with an expired date.
    document.cookie.split('; ').forEach((row) => {
      const name = row.split('=')[0];
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
  });

  it('returns undefined for missing cookie', () => {
    expect(readCookie('csrf_token')).toBeUndefined();
  });

  it('reads a plain cookie value', () => {
    document.cookie = 'csrf_token=abc123';
    expect(readCookie('csrf_token')).toBe('abc123');
  });

  it('decodes URL-encoded values', () => {
    document.cookie = 'csrf_token=' + encodeURIComponent('a/b=c');
    expect(readCookie('csrf_token')).toBe('a/b=c');
  });

  it('ignores cookies with similar prefixes', () => {
    document.cookie = 'csrf_token_other=nope';
    document.cookie = 'csrf_token=real';
    expect(readCookie('csrf_token')).toBe('real');
  });
});
