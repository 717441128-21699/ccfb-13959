/**
 * 端到端自动化验证(headless Chrome 跑真实 WebGL2 管线)。
 * 结果写入 #e2e-result 与 document.title,dump-dom 即可读取。
 */
import { generateImage, herbObjectSpecs, rng } from '../src/synthetic/generator';
import { analyzeImage } from '../src/cv/pipeline';
import { evaluate } from '../src/evaluation/metrics';
import { identifySample } from '../src/cv/matcher';
import { HERB_PROFILES } from '../src/data/herbs';

const HERB_IDS = [
  'dahuang', 'renshen', 'gancao', 'huanglian', 'huangbo',
  'houpo', 'rougui', 'dingxiang', 'jinyinhua', 'banxia', 'puhuang',
];

async function main() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) throw new Error('no webgl2');
  const float = gl.getExtension('EXT_color_buffer_float');

  const N = 12; // 常规场景张数
  const reports: ReturnType<typeof evaluate>[] = [];
  const timings: number[] = [];
  const herbRows: { expected: string; top1: string; ok: boolean }[] = [];

  const runOne = async (i: number, stain: boolean) => {
    const seed = 7000 + i * 53;
    const r = rng(seed);
    const herbId = HERB_IDS[i % HERB_IDS.length];
    const specs = herbObjectSpecs(herbId, r);
    const stainOpts = stain
      ? { stainHue: (r() - 0.5) * 90, stainBrightness: 0.55 + r() * 0.9, stainSaturation: 0.3 + r() }
      : {};
    const synth = generateImage({
      seed, specs, width: 1024, height: 768,
      bubbles: 6, debris: 45, ...stainOpts,
    });
    const bitmap = await createImageBitmap(synth.canvas);
    const analysis = analyzeImage(bitmap, `e2e-${i}`);
    timings.push(Object.values(analysis.timings).reduce((a, b) => a + b, 0));
    const rep = evaluate(synth.groundTruth, analysis.annotations, analysis.regions);
    reports.push(rep);
    const verdict = identifySample([analysis], HERB_PROFILES);
    herbRows.push({ expected: herbId, top1: verdict.matches[0]?.herbId ?? '?', ok: verdict.matches[0]?.herbId === herbId });
  };

  for (let i = 0; i < N; i++) await runOne(i, false);
  const stainReports: ReturnType<typeof evaluate>[] = [];
  for (let i = 0; i < 6; i++) {
    await runOne(N + i, true);
    stainReports.push(reports[reports.length - 1]);
  }

  // 掺伪场景 4 张
  const { generateAdulteratedImage } = await import('../src/synthetic/generator');
  const adulRows: { primary: string; secondary: string; detected: boolean; predicted: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const primary = HERB_IDS[i % HERB_IDS.length];
    const secondary = HERB_IDS[(i + 5) % HERB_IDS.length];
    const synth = generateAdulteratedImage(primary, secondary, { seed: 9000 + i, width: 1024, height: 768 });
    const bitmap = await createImageBitmap(synth.canvas);
    const analysis = analyzeImage(bitmap, `adult-${i}`);
    const verdict = identifySample([analysis], HERB_PROFILES);
    adulRows.push({
      primary,
      secondary,
      detected: verdict.adulteration.detected,
      predicted: verdict.adulteration.secondaryHerbId ?? '',
    });
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const result = {
    webgl2: true,
    floatColorBuffer: !!float,
    normal: {
      images: N,
      meanAccuracy: avg(reports.slice(0, N).map((r) => r.overallAccuracy)),
      macroF1: avg(reports.slice(0, N).map((r) => r.macroF1)),
      meanIoU: avg(reports.slice(0, N).map((r) => r.meanIoU)),
      sharpnessMAE: avg(reports.slice(0, N).map((r) => r.attributeErrors.crystalSharpnessMAE)),
      pitMAE: avg(reports.slice(0, N).map((r) => r.attributeErrors.pitDensityMAE)),
    },
    stain: {
      images: 6,
      meanAccuracy: avg(stainReports.map((r) => r.overallAccuracy)),
      macroF1: avg(stainReports.map((r) => r.macroF1)),
    },
    herbTop1: `${herbRows.filter((x) => x.ok).length}/${herbRows.length}`,
    herbRows,
    adulteration: adulRows,
    perImageMs: avg(timings),
    estimated30ImagesSec: (avg(timings) * 30) / 1000,
  };

  const text = JSON.stringify(result, null, 2);
  document.getElementById('e2e-result')!.textContent = text;
  document.title = 'E2E_DONE';
  // 也打到 console,便于 --enable-logging 抓取
  console.log('E2E_RESULT ' + text);
}

main().catch((e) => {
  const text = 'ERROR: ' + (e?.stack || e?.message || String(e));
  document.getElementById('e2e-result')!.textContent = text;
  document.title = 'E2E_ERROR';
});
