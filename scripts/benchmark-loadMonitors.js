import { loadMonitors } from '../background/page-monitor.js';

// Mock chrome.storage.local.get to simulate I/O overhead
global.chrome = {
  storage: {
    local: {
      get: async (key) => {
        // Simulate small async delay typical of extension storage reads
        await new Promise(resolve => setTimeout(resolve, 1));
        return {
          [key]: [
            { id: '1', url: 'https://example.com' },
            { id: '2', url: 'https://example.org' },
            { id: '3', url: 'https://example.net' }
          ]
        };
      },
      set: async (obj) => {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }
  }
};

async function benchmark() {
  console.log('--- Starting Benchmark: Repeated loadMonitors ---');

  const iterations = 1000;
  let totalTime = 0;

  // Warmup
  for (let i = 0; i < 100; i++) {
    await loadMonitors();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await loadMonitors();
  }
  const end = performance.now();

  totalTime = end - start;

  console.log(`Executed ${iterations} calls to loadMonitors`);
  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per call: ${(totalTime / iterations).toFixed(2)}ms`);
  console.log('-------------------------------------------------');
}

benchmark().catch(console.error);
