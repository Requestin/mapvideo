import { describe, it, expect, beforeEach } from 'vitest';
import { http } from '../src/api/http';
import type { InternalAxiosRequestConfig } from 'axios';

function runInterceptor(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  // The request interceptor chain stores [fulfilled, rejected] pairs in
  // the handlers array. We only set one, so index 0 is the one to run.
  const handler = (http.interceptors.request as unknown as {
    handlers: Array<{ fulfilled: (c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig }>;
  }).handlers[0];
  return handler.fulfilled(config);
}

describe('http request interceptor', () => {
  beforeEach(() => {
    document.cookie.split('; ').forEach((row) => {
      const name = row.split('=')[0];
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
  });

  it('does not attach CSRF header to GET', () => {
    document.cookie = 'csrf_token=T1';
    const out = runInterceptor({ method: 'get', headers: {} } as InternalAxiosRequestConfig);
    expect(out.headers?.['X-CSRF-Token']).toBeUndefined();
  });

  it('attaches CSRF header to POST when cookie is present', () => {
    document.cookie = 'csrf_token=T2';
    const out = runInterceptor({ method: 'post', headers: {} } as InternalAxiosRequestConfig);
    expect(out.headers?.['X-CSRF-Token']).toBe('T2');
  });

  it('omits CSRF header on POST when cookie is missing', () => {
    const out = runInterceptor({ method: 'post', headers: {} } as InternalAxiosRequestConfig);
    expect(out.headers?.['X-CSRF-Token']).toBeUndefined();
  });

  it('attaches CSRF header to DELETE', () => {
    document.cookie = 'csrf_token=T3';
    const out = runInterceptor({ method: 'DELETE', headers: {} } as InternalAxiosRequestConfig);
    expect(out.headers?.['X-CSRF-Token']).toBe('T3');
  });
});
