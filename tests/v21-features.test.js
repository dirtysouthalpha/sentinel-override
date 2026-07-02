// Tests for v21.6.44-46 features
import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('v21.6.44 Circuit Breaker Fixes', () => {
  test('circuit breaker uses const not var declarations', () => {
    const enginePath = path.resolve(__dirname, '../background/agent-engine.js');
    const content = fs.readFileSync(enginePath, 'utf-8');
    // Extract the circuit breaker block
    const cbStart = content.indexOf('v21.6.38: Force-finish on identical action loops');
    expect(cbStart).toBeGreaterThan(-1);
    const cbBlock = content.substring(cbStart, cbStart + 1000);
    // Should use const, not var
    expect(cbBlock).not.toContain('var _cbLoopCount');
    expect(cbBlock).not.toContain('var _cbMemKeys');
  });

  test('execute_js auto-finish captures report data', () => {
    const enginePath = path.resolve(__dirname, '../background/agent-engine.js');
    const content = fs.readFileSync(enginePath, 'utf-8');
    // Find the auto-finish block
    const afStart = content.indexOf('AUTO-FINISH: You already have');
    expect(afStart).toBeGreaterThan(-1);
    const afBlock = content.substring(afStart, afStart + 800);
    // Should have captureReportData and sendReportUpdate
    expect(afBlock).toContain('captureReportData');
  });
});

describe('v21.6.45 SSL Cert Detection', () => {
  test('cert error keywords are detectable in code', () => {
    const enginePath = path.resolve(__dirname, '../background/agent-engine.js');
    const content = fs.readFileSync(enginePath, 'utf-8');
    expect(content).toContain('CERT WARNING DETECTION');
    expect(content).toContain('privacy error');
    expect(content).toContain('not private');
    expect(content).toContain('setIgnoreCertificateErrors');
  });
});

describe('v21.6.46 MSP Templates', () => {
  test('SonicWall template exists', () => {
    const tmplPath = path.resolve(__dirname, '../background/template-manager.js');
    const content = fs.readFileSync(tmplPath, 'utf-8');
    expect(content).toContain('builtin-sonicwall-rules');
    expect(content).toContain('SonicWall Access Rule Audit');
    expect(content).toContain('Access Rules');
  });

  test('Exchange mail trace template exists', () => {
    const tmplPath = path.resolve(__dirname, '../background/template-manager.js');
    const content = fs.readFileSync(tmplPath, 'utf-8');
    expect(content).toContain('builtin-exchange-mailtrace');
    expect(content).toContain('Exchange Mail Trace');
  });

  test('Entra ID sign-in audit template exists', () => {
    const tmplPath = path.resolve(__dirname, '../background/template-manager.js');
    const content = fs.readFileSync(tmplPath, 'utf-8');
    expect(content).toContain('builtin-entra-signin');
    expect(content).toContain('Entra ID Sign-In Audit');
  });

  test('CISA KEV template exists', () => {
    const tmplPath = path.resolve(__dirname, '../background/template-manager.js');
    const content = fs.readFileSync(tmplPath, 'utf-8');
    expect(content).toContain('builtin-cisa-kev');
    expect(content).toContain('CISA KEV Vulnerability Check');
  });
});
