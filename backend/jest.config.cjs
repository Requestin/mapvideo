/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  // DB setup/teardown and env loader live in globalSetup/globalTeardown so a
  // single pool + a single migration run is shared across the suite.
  globalSetup: '<rootDir>/tests/global-setup.ts',
  globalTeardown: '<rootDir>/tests/global-teardown.ts',
  // Tests hit real PostgreSQL and sometimes the public Photon API, so keep a
  // generous timeout to avoid flakes on slow CI.
  testTimeout: 15_000,
  clearMocks: true,
  // express-rate-limit's MemoryStore holds an interval timer that Jest cannot
  // see through to shut down. globalTeardown already closes the pg pool, so
  // forcing exit after the suite finishes is safe.
  forceExit: true,
};
