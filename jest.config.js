/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // tests/live/ makes real network calls to live model endpoints. It is
  // excluded from `npm test` (and therefore from `npm run check`) so the gate
  // stays hermetic; run it with `npm run test:live`.
  testPathIgnorePatterns: ['/node_modules/', '/.claude/', '/tests/live/'],
  collectCoverage: false,
};
