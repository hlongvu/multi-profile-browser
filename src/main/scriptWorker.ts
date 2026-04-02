import { workerData, parentPort } from 'worker_threads';
import { chromium } from 'playwright-core';

const { scriptCode, profileIndex } = workerData as { scriptCode: string; profileIndex: number };

async function run() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[profileIndex];
  if (!context) throw new Error(`No context at index ${profileIndex}`);
  const page = context.pages()[0] ?? await context.newPage();

  const log = (level: string, ...args: unknown[]) =>
    parentPort!.postMessage({ type: 'log', level, message: args.join(' '), ts: Date.now() });

  const consoleObj = {
    log: (...a: unknown[]) => log('log', ...a),
    warn: (...a: unknown[]) => log('warn', ...a),
    error: (...a: unknown[]) => log('error', ...a),
  };

  const fn = new Function('page', 'console', `return (async () => { ${scriptCode} })()`);
  await fn(page, consoleObj);
  parentPort!.postMessage({ type: 'done', success: true });
}

run().catch(err => {
  parentPort!.postMessage({ type: 'done', success: false, error: err.message });
});
