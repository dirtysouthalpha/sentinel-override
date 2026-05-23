// jest.config.js
/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/tests/**/*.test.js'],
  moduleNameMapper: {},
  // Disable coverage for now - focus on making tests pass
  collectCoverage: false,
};
