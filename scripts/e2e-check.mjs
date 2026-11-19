/**
 * 无头浏览器端到端验证：
 * 1. 真实 WebGL2（SwiftShader 软渲染）跑完整 GPU 管线
 * 2. 合成多味药图像 → 检测 → 统计结构识别 F1、Top-1、掺伪检出、耗时
 * 用法：node scripts/e2e-check.mjs
 */
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const N = parseInt(process.argv[2] || '12', 10);

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
  protocolTimeout: 300000,
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#glCanvas');
await new Promise((r) => setTimeout(r, 800));
const gpuChip = await page.$eval('#gpuStatus', (el) => el.textContent);
console.log('GPU 状态：', gpuChip);

// 在页面内直接调用应用模块做批量评测（复用 UI 已初始化的 engine）
const result = await page.evaluate(async (count) => {
  const mod = await import('/src/ui/evalRunner.ts');
  const { GpuEngine } = await import('/src/gpu/GpuEngine.ts');
  const engine = new GpuEngine(document.getElementById('glCanvas'), 1024, 1024);
  const { report } = await mod.runEvaluation(engine, count, 20261120);
  return report;
}, N);

console.log('\n===== 端到端评测（无头 WebGL2 / SwiftShader）=====');
console.log(`图像数：${result.imageCount}，金标准目标：${result.totalGt}，检出目标：${result.totalDetected}`);
console.log(`微平均 精确率 ${(result.micro.precision * 100).toFixed(1)}% / 召回率 ${(result.micro.recall * 100).toFixed(1)}% / F1 ${(result.micro.f1 * 100).toFixed(1)}%`);
console.log(`药材 Top-1 ${(result.top1 * 100).toFixed(1)}% / Top-3 ${(result.top3 * 100).toFixed(1)}%`);
console.log(`掺伪检出率 ${(result.mixtureRecall * 100).toFixed(1)}% / 误报率 ${(result.mixtureFalseRate * 100).toFixed(1)}%`);
console.log(`单张平均 ${result.avgImageMs.toFixed(0)}ms / P95 ${result.p95ImageMs.toFixed(0)}ms / 30 张推算 ${((result.avgImageMs * 30) / 1000).toFixed(1)}s（限值 120s）`);
console.log('\n分类别 F1：');
for (const t of result.perType) {
  console.log(
    `  ${t.type.padEnd(16)} P ${(t.precision * 100).toFixed(1).padStart(5)}%  R ${(t.recall * 100).toFixed(1).padStart(5)}%  F1 ${(t.f1 * 100).toFixed(1).padStart(5)}%  (TP${t.tp}/FP${t.fp}/FN${t.fn})`,
  );
}
if (result.confusion && Object.keys(result.confusion).length) {
  console.log('\n混淆矩阵（真值→预测：次数）');
  for (const [gt, row] of Object.entries(result.confusion)) {
    for (const [pred, n] of Object.entries(row)) console.log(`  ${gt} → ${pred}: ${n}`);
  }
}
console.log('\n页面错误：', errors.length ? errors.join('\n') : '无');

await browser.close();
await server.close();

const ok =
  errors.length === 0 &&
  result.micro.f1 >= 0.9 &&
  result.top1 >= 0.9 &&
  result.avgImageMs * 30 <= 120000;
console.log(ok ? '\n✅ 端到端达标' : '\n⚠ 端到端未全部达标（见上方指标，按提示调参/调规则）');
process.exit(ok ? 0 : 2);
