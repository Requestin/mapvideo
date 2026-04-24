import request from 'supertest';
import { createApp } from '../src/app';
import { loginAsAdmin } from './helpers';

describe('GET /api/health', () => {
  const app = createApp();

  it('200 returns { status: "ok", time: ISO8601 } without auth', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.time).toBe('string');
    expect(Number.isFinite(Date.parse(res.body.time))).toBe(true);
  });
});

describe('GET /api/fonts', () => {
  const app = createApp();

  it('401 without auth', async () => {
    const res = await request(app).get('/api/fonts');
    expect(res.status).toBe(401);
  });

  it('200 returns the on-disk font list with family/fileName/url', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    const res = await request(app).get('/api/fonts').set(authHeaders);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.fonts)).toBe(true);
    expect(res.body.fonts.length).toBeGreaterThan(0);

    const montserrat = res.body.fonts.find(
      (f: { fileName: string }) => f.fileName === 'Montserrat-Regular.ttf'
    );
    expect(montserrat).toBeDefined();
    expect(montserrat.family).toBe('Montserrat');
    expect(montserrat.url).toBe('/assets/fonts/Montserrat-Regular.ttf');
    // task13: новый контракт — числовой CSS-вес + локализованная метка.
    expect(montserrat.weight).toBe(400);
    expect(typeof montserrat.weightLabel).toBe('string');
  });

  it('parses common weight suffixes from filenames', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    const res = await request(app).get('/api/fonts').set(authHeaders);
    type Font = { fileName: string; weight: number };
    const byFile = (name: string): Font | undefined =>
      (res.body.fonts as Font[]).find((f) => f.fileName === name);
    expect(byFile('Montserrat-Thin.ttf')?.weight).toBe(100);
    expect(byFile('Montserrat-ExtraLight.ttf')?.weight).toBe(200);
    expect(byFile('Montserrat-Light.ttf')?.weight).toBe(300);
    expect(byFile('Montserrat-Medium.ttf')?.weight).toBe(500);
    expect(byFile('Montserrat-SemiBold.ttf')?.weight).toBe(600);
    expect(byFile('Montserrat-Bold.ttf')?.weight).toBe(700);
    expect(byFile('Montserrat-ExtraBold.ttf')?.weight).toBe(800);
    expect(byFile('Montserrat-Black.ttf')?.weight).toBe(900);
    // Файл без `-` читается как Regular-400 (например `Supermolot.ttf`).
    expect(byFile('Supermolot.ttf')?.weight).toBe(400);
  });
});

describe('GET /api/geocode/search', () => {
  const app = createApp();

  // Stub global fetch so the test never hits the public Photon instance.
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('401 without auth', async () => {
    const res = await request(app).get('/api/geocode/search?q=Moscow');
    expect(res.status).toBe(401);
  });

  it('400 when q is missing', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    const res = await request(app).get('/api/geocode/search').set(authHeaders);
    expect(res.status).toBe(400);
  });

  it('200 transforms Photon features to the expected result shape', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [37.617, 55.755] },
            properties: { name: 'Москва', city: 'Москва', country: 'Россия' },
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [30.315, 59.939] },
            properties: { name: 'Санкт-Петербург', country: 'Россия' },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const res = await request(app).get('/api/geocode/search?q=Russia&limit=5').set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0]).toEqual({
      name: 'Москва',
      fullName: 'Москва, Москва, Россия',
      coordinates: { lng: 37.617, lat: 55.755 },
    });
    expect(res.body.results[1].fullName).toBe('Санкт-Петербург, Россия');
  });

  it('502 when Photon returns non-OK', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const res = await request(app).get('/api/geocode/search?q=anything').set(authHeaders);
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Геокодер недоступен');
  });

  it('502 when fetch throws (network / timeout)', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })) as unknown as typeof fetch;

    const res = await request(app).get('/api/geocode/search?q=slow').set(authHeaders);
    expect(res.status).toBe(502);
  });
});

describe('GET /api/route', () => {
  const app = createApp();
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('401 without auth', async () => {
    const res = await request(app).get('/api/route?start=37.6,55.7&end=30.3,59.9');
    expect(res.status).toBe(401);
  });

  it('400 when start/end are missing or malformed', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    const r1 = await request(app).get('/api/route').set(authHeaders);
    expect(r1.status).toBe(400);
    const r2 = await request(app)
      .get('/api/route?start=not-a-coord&end=30,60')
      .set(authHeaders);
    expect(r2.status).toBe(400);
    const r3 = await request(app)
      .get('/api/route?start=37,55&end=999,999')
      .set(authHeaders);
    expect(r3.status).toBe(400);
  });

  it('200 + fallback:false transforms OSRM geometry into lng/lat points', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            geometry: {
              type: 'LineString',
              coordinates: [
                [37.618, 55.751],
                [37.7, 55.8],
                [30.315, 59.939],
              ],
            },
            distance: 707_000,
            duration: 30_000,
          },
        ],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await request(app)
      .get('/api/route?start=37.618,55.751&end=30.315,59.939')
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(false);
    expect(res.body.coordinates).toEqual([
      { lng: 37.618, lat: 55.751 },
      { lng: 37.7, lat: 55.8 },
      { lng: 30.315, lat: 59.939 },
    ]);
    expect(res.body.distance).toBe(707_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('overview=simplified');
    expect(calledUrl).toContain('geometries=geojson');
    expect(calledUrl).toContain('steps=false');
    expect(calledUrl).toContain('annotations=false');
  });

  it('200 + fallback:true when OSRM returns non-200', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const res = await request(app)
      .get('/api/route?start=37.618,55.751&end=30.315,59.939')
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
    // Контракт SPEC §"Обработка fallback OSRM": прямая линия между двумя точками.
    expect(res.body.coordinates).toEqual([
      { lng: 37.618, lat: 55.751 },
      { lng: 30.315, lat: 59.939 },
    ]);
  });

  it('200 + fallback:true when OSRM code is not Ok (NoRoute/InvalidQuery)', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 'NoRoute', routes: [] }),
    }) as unknown as typeof fetch;

    const res = await request(app)
      .get('/api/route?start=0,0&end=1,1')
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
  });

  it('200 + fallback:true on network/abort errors', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('boom'), { name: 'AbortError' })) as unknown as typeof fetch;

    const res = await request(app)
      .get('/api/route?start=37.618,55.751&end=30.315,59.939')
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
  });
});

describe('User custom colors API', () => {
  const app = createApp();

  it('GET /api/users/me/colors → 401 without auth', async () => {
    const res = await request(app).get('/api/users/me/colors');
    expect(res.status).toBe(401);
  });

  it('GET /api/users/me/colors → 200 returns persisted array (default empty)', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    const res = await request(app).get('/api/users/me/colors').set(authHeaders);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.colors)).toBe(true);
  });

  it('PUT /api/users/me/colors → 403 without CSRF header', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    const res = await request(app)
      .put('/api/users/me/colors')
      .set(authHeaders)
      .send({ colors: ['#ff0000'] });
    expect(res.status).toBe(403);
  });

  it('PUT /api/users/me/colors → 200 persists + normalizes (lowercase, dedup, filter bad hex)', async () => {
    const { csrfHeaders } = await loginAsAdmin(app);
    const res = await request(app)
      .put('/api/users/me/colors')
      .set(csrfHeaders)
      .send({ colors: ['#FF0000', '#ff0000', 'not-a-color', '#00ff00'] });
    expect(res.status).toBe(200);
    expect(res.body.colors).toEqual(['#ff0000', '#00ff00']);

    // Round-trip: GET returns the same list.
    const after = await request(app)
      .get('/api/users/me/colors')
      .set({ cookie: csrfHeaders.cookie });
    expect(after.body.colors).toEqual(['#ff0000', '#00ff00']);
  });

  it('PUT /api/users/me/colors → 400 when array is too long', async () => {
    const { csrfHeaders } = await loginAsAdmin(app);
    const tooMany = Array.from({ length: 11 }, (_, i) =>
      `#${i.toString(16).padStart(2, '0')}0000`
    );
    const res = await request(app)
      .put('/api/users/me/colors')
      .set(csrfHeaders)
      .send({ colors: tooMany });
    expect(res.status).toBe(400);
  });

  it('PUT /api/users/me/colors → 400 when body is not an array', async () => {
    const { csrfHeaders } = await loginAsAdmin(app);
    const res = await request(app)
      .put('/api/users/me/colors')
      .set(csrfHeaders)
      .send({ colors: '#ff0000' });
    expect(res.status).toBe(400);
  });
});

describe('Module unit: users-service.validatePasswordComplexity', () => {
  it('enforces min length, digit, letter', async () => {
    const { validatePasswordComplexity } = await import('../src/services/users-service');
    expect(validatePasswordComplexity('short')).toBe(false);
    expect(validatePasswordComplexity('longbutnodigit')).toBe(false);
    expect(validatePasswordComplexity('12345678')).toBe(false);
    expect(validatePasswordComplexity('Passw0rd!')).toBe(true);
    expect(validatePasswordComplexity('Пароль1')).toBe(false); // 7 chars — too short
    expect(validatePasswordComplexity('Пароль12')).toBe(true); // 8 chars, letters + digit
  });
});

describe('Module unit: users-service.validateUsername', () => {
  it('accepts alphanumerics/underscore/dash/dot in 3..50', async () => {
    const { validateUsername } = await import('../src/services/users-service');
    expect(validateUsername('a')).toBe(false);
    expect(validateUsername('ab')).toBe(false);
    expect(validateUsername('abc')).toBe(true);
    expect(validateUsername('user_name-1.2')).toBe(true);
    expect(validateUsername('space not allowed')).toBe(false);
    expect(validateUsername('x'.repeat(51))).toBe(false);
  });
});
