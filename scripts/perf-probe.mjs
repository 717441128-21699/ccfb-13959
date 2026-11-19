/**
 * 性能探针：单张图分步计时，定位 GPU 回读 / CPU 测量热点。
 * 用法：node scripts/perf-probe.mjs [workSize]
 */
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workSize = parseInt(process.argv[2] || '512', 10);
function freePort() {
  return new Promise((res, rej) => {
    const srv = createNetServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => res(p));
    });
  });
}
const port = await freePort();
const server = await createServer({ root, server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 180000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 500));

const probe = await page.evaluate(async (size) => {
  const { GpuEngine } = await import('/src/gpu/GpuEngine.ts');
  const { runGpuPipeline, DEFAULT_PARAMS } = await import('/src/core/gpuPipeline.ts');
  const { measureAllObjects } = await import('/src/core/measurement.ts');
  const { classifyAll } = await import('/src/core/classifier.ts');
  const { matchDrugs, detectMixture } = await import('/src/core/matcher.ts');
  const { generateSyntheticImage } = await import('/src/synthetic/syntheticGenerator.ts');
  const { DRUG_MAP } = await import('/src/core/knowledgeBase.ts');

  const canvas = document.getElementById('glCanvas');
  const tEngine = performance.now();
  const engine = new GpuEngine(canvas, size, size);
  const engineMs = performance.now() - tEngine;

  const sample = generateSyntheticImage({ drugs: [DRUG_MAP.dahuang], seed: 7 });
  const params = { ...DEFAULT_PARAMS, workSize: size };

  const tPipe = performance.now();
  const { inter, gpuMs, cpuMs } = runGpuPipeline(engine, sample.canvas, params);
  const pipeWall = performance.now() - tPipe;

  const tMeasure = performance.now();
  const objects = measureAllObjects(inter, sample.scaleUmPerPx, params.minAreaPx);
  const measureMs = performance.now() - tMeasure;

  const tClassify = performance.now();
  const cls = classifyAll(objects);
  const classifyMs = performance.now() - tClassify;

  const tMatch = performance.now();
  const matches = matchDrugs(cls);
  const mix = detectMixture(cls, matches);
  const matchMs = performance.now() - tMatch;

  return {
    size,
    engineMs,
    pipeWall,
    gpuMs,
    cpuMs,
    measureMs,
    classifyMs,
    matchMs,
    objectCount: cls.length,
    gtCount: sample.groundTruth.length,
    top: matches[0],
    mix: mix.detected,
    typeCounts: cls.reduce((acc, o) => ((acc[o.type] = (acc[o.type] || 0) + 1), acc), {}),
  };
}, workSize);

console.log(JSON.stringify(probe, null, 2));
await browser.close();
await server.close();
process.exit(0);
