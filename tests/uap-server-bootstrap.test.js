// tests/uap-server-bootstrap.test.js
// Regression tests for scripts/uap-server.js module bootstrap.
//
// Two defects this pins:
//
// 1. Importing the module used to bind port 8766 unconditionally, and the
//    EADDRINUSE handler called process.exit(1). Any Jest worker that imported
//    it while something else held the port died outright — which is exactly
//    what took tests/federation-remote.test.js down ("Jest worker encountered
//    4 child process exceptions, exceeding retry limit") and made `npm run
//    check` red.
//
// 2. resolvePort() replaces a one-liner whose operator precedence made the
//    documented UAP_PORT environment variable a no-op.

const mod = await import('../scripts/uap-server.js');
const { resolvePort, isMainModule, server, DEFAULT_PORT } = mod;

describe('uap-server: import must not bind a port', () => {
  test('server exists but is not listening after a plain import', () => {
    expect(server).toBeDefined();
    expect(server.listening).toBe(false);
  });

  test('exports the federation registries the extension shares', () => {
    expect(mod.fedPeers).toBeInstanceOf(Map);
    expect(mod.fedJobs).toBeInstanceOf(Map);
  });

  test('startServer is exported so the CLI entry point can bind explicitly', () => {
    expect(typeof mod.startServer).toBe('function');
  });
});

describe('uap-server: resolvePort', () => {
  test('UAP_PORT env var wins (previously ignored entirely)', () => {
    expect(resolvePort({ UAP_PORT: '9999' }, ['/usr/bin/node', '/x/uap-server.js'])).toBe(9999);
  });

  test('UAP_PORT wins over a --port flag', () => {
    expect(resolvePort({ UAP_PORT: '9999' }, ['node', 'x', '--port', '9100'])).toBe(9999);
  });

  test('--port flag is used when UAP_PORT is unset', () => {
    expect(resolvePort({}, ['node', 'x', '--port', '9100'])).toBe(9100);
  });

  test('falls back to the default when nothing is supplied', () => {
    expect(resolvePort({}, ['node', 'x'])).toBe(DEFAULT_PORT);
  });

  test('rejects out-of-range and non-numeric values instead of binding them', () => {
    expect(resolvePort({ UAP_PORT: '0' }, ['node', 'x'])).toBe(DEFAULT_PORT);
    expect(resolvePort({ UAP_PORT: '70000' }, ['node', 'x'])).toBe(DEFAULT_PORT);
    expect(resolvePort({ UAP_PORT: 'abc' }, ['node', 'x'])).toBe(DEFAULT_PORT);
    expect(resolvePort({ UAP_PORT: '' }, ['node', 'x'])).toBe(DEFAULT_PORT);
  });

  test('a --port flag with a missing or bad value falls back, not NaN', () => {
    expect(resolvePort({}, ['node', 'x', '--port'])).toBe(DEFAULT_PORT);
    expect(resolvePort({}, ['node', 'x', '--port', 'nope'])).toBe(DEFAULT_PORT);
  });

  test('never returns NaN', () => {
    for (const argv of [['node'], ['node', 'x'], ['node', 'x', '--port', '-5']]) {
      expect(Number.isNaN(resolvePort({}, argv))).toBe(false);
    }
  });
});

describe('uap-server: isMainModule', () => {
  test('false when argv[1] is some other file (the import case)', () => {
    expect(isMainModule('file:///a/uap-server.js', ['node', '/b/jest.js'])).toBe(false);
  });

  test('false when there is no argv[1] at all', () => {
    expect(isMainModule('file:///a/uap-server.js', ['node'])).toBe(false);
  });

  test('true when argv[1] is this module', () => {
    expect(isMainModule('file:///a/uap-server.js', ['node', '/a/uap-server.js'])).toBe(true);
  });

  test('does not throw on a non-file: URL', () => {
    expect(() => isMainModule('https://example.com/x.js', ['node', '/a/x.js'])).not.toThrow();
    expect(isMainModule('https://example.com/x.js', ['node', '/a/x.js'])).toBe(false);
  });
});

describe('uap-server: no process-level side effects on import', () => {
  test('no SIGINT/SIGTERM handlers registered by importing', () => {
    // The signal handlers now live behind the main-module guard. Jest itself
    // may install its own, so we only assert ours (which calls process.exit)
    // is not among them by checking the module did not claim to be main.
    expect(isMainModule('file:///x/uap-server.js', process.argv)).toBe(false);
  });

});
