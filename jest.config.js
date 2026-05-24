// jest.config.js
/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/.claude/'],
  moduleNameMapper: {},
  collectCoverage: false,
};
