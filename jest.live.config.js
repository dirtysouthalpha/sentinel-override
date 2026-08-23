/** @type {import('jest').Config} */
// Config for the LIVE model smoke tests (tests/live/). Separate from
// jest.config.js so `npm test` / `npm run check` stay hermetic — nothing in the
// quality gate touches the network. Run with `npm run test:live`.
export default {
  testEnvironment: 'node',
  testMatch: ['**/tests/live/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  testTimeout: 300000,
  collectCoverage: false,
};
