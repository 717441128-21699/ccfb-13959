import { useState } from 'react';
import {
  generateImage,
  generateAdulteratedImage,
  herbObjectSpecs,
  rng,
  type SyntheticImage,
} from '../synthetic/generator';
import { analyzeImage } from '../cv/pipeline';
import { identifySample } from '../cv/matcher';
import { evaluate, type EvalReport } from '../evaluation/metrics';
import { useApp } from '../state/AppContext';
import { AnnotationCanvas } from './AnnotationCanvas';
import { STRUCTURE_LABELS, type Annotation } from '../types';

interface BatchResult {
  report: EvalReport;
  totalMs: number;
  perImageMs: number[];
  herbTop1: number;
  herbTotal: number;
  adulterationHits: number;
  adulterationTotal: number;
  preview: SyntheticImage;
  previewAnns: Annotation[];
  stainDrift: { hue: number; brightness: number };
}

const HERB_IDS = [
  'dahuang', 'renshen', 'gancao', 'huanglian', 'huangbo',
  'houpo', 'rougui', 'dingxiang', 'jinyinhua', 'banxia', 'puhuang',
];

export function SyntheticTab() {
  const { profiles, settings } = useApp();
  const [nImages, setNImages] = useState(20);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState<'normal' | 'stain' | 'adulterate'>('normal');

  const runBatch = async () => {
    setRunning(true);
    setStatus('生成合成图并跑 GPU 管线…');
    await new Promise((r) => setTimeout(r, 0));

    let mergedReport: EvalReport | null = null;
    const timings: number[] = [];
    let herbTop1 = 0;
    let herbTotal = 0;
    let adulHits = 0;
    let adulTotal = 0;
    let preview: SyntheticImage | null = null;
    let previewAnns: Annotation[] = [];
    let stainDrift = { hue: 0, brightness: 0 };

    // 合并评测所需的累计容器
    const merge = (rep: EvalReport) => {
      if (!mergedReport) {
        mergedReport = JSON.parse(JSON.stringify(rep)) as EvalReport;
        // 初始化累计匹配数
        for (const c of mergedReport.perClass) (c as any).matchedN = c.tp;
        return;
      }
      for (let i = 0; i < rep.perClass.length; i++) {
        const a = mergedReport.perClass[i] as any;
        const b = rep.perClass[i] as any;
        a.tp += b.tp; a.fp += b.fp; a.fn += b.fn;
        a.matchedN += b.tp; // 匹配且类别正确的累计数
        a.precision = (a.tp + a.fp) === 0 ? 0 : a.tp / (a.tp + a.fp);
        a.recall = (a.tp + a.fn) === 0 ? 0 : a.tp / (a.tp + a.fn);
        a.f1 = (a.precision + a.recall) === 0 ? 0 : (2 * a.precision * a.recall) / (a.precision + a.recall);
        const matchedTotal = a.tp + a.fp;
        a.classificationAccuracy = matchedTotal === 0 ? 1 : a.matchedN / matchedTotal;
      }
      mergedReport.meanIoU = (mergedReport.meanIoU + rep.meanIoU) / 2;
      mergedReport.overallAccuracy =
        (mergedReport.overallAccuracy + rep.overallAccuracy) / 2;
      mergedReport.macroF1 = (mergedReport.macroF1 + rep.macroF1) / 2;
      mergedReport.attributeErrors.crystalSharpnessMAE =
        (mergedReport.attributeErrors.crystalSharpnessMAE + rep.attributeErrors.crystalSharpnessMAE) / 2;
      mergedReport.attributeErrors.pitDensityMAE =
        (mergedReport.attributeErrors.pitDensityMAE + rep.attributeErrors.pitDensityMAE) / 2;
    };

    const t0 = performance.now();
    for (let i = 0; i < nImages; i++) {
      setStatus(`第 ${i + 1}/${nImages} 张`);
      await new Promise((r) => setTimeout(r, 0));
      const seed = 1000 + i * 37;
      const r = rng(seed);
      const herbId = HERB_IDS[Math.floor(r() * HERB_IDS.length)];
      const specs = herbObjectSpecs(herbId, r);

      // 染色扰动模式:大幅漂移色调与亮度,验证颜色不变性
      const stainOpts = mode === 'stain'
        ? { stainHue: (r() - 0.5) * 90, stainBrightness: 0.55 + r() * 0.9, stainSaturation: 0.3 + r() * 1.2 }
        : {};

      let synth: SyntheticImage;
      let expectedSecondary: string | null = null;
      if (mode === 'adulterate' && i % 2 === 0) {
        const other = HERB_IDS[Math.floor(r() * HERB_IDS.length)];
        const second = other === herbId ? HERB_IDS[(HERB_IDS.indexOf(herbId) + 3) % HERB_IDS.length] : other;
        expectedSecondary = second;
        synth = generateAdulteratedImage(herbId, second, { seed, ...stainOpts });
      } else {
        synth = generateImage({ seed, specs, ...stainOpts });
      }
      stainDrift = {
        hue: Math.round(synth.stain.hue),
        brightness: Math.round(synth.stain.brightness * 100) / 100,
      };

      const bitmap = await createImageBitmap(synth.canvas);
      const analysis = analyzeImage(bitmap, `synth-${i}`, settings.thresholdC);
      timings.push(Object.values(analysis.timings).reduce((a, b) => a + b, 0));

      const rep = evaluate(synth.groundTruth, analysis.annotations, analysis.regions);
      merge(rep);

      // 药材 Top-1 命中率
      const verdict = identifySample([analysis], profiles);
      herbTotal++;
      if (verdict.matches[0]?.herbId === herbId) herbTop1++;
      if (expectedSecondary) {
        adulTotal++;
        if (verdict.adulteration.detected &&
          verdict.adulteration.secondaryHerbId === expectedSecondary) {
          adulHits++;
        }
      }

      if (i === 0) {
        preview = synth;
        previewAnns = analysis.annotations;
      }
    }
    const totalMs = performance.now() - t0;
    setResult({
      report: mergedReport!,
      totalMs,
      perImageMs: timings,
      herbTop1,
      herbTotal,
      adulterationHits: adulHits,
      adulterationTotal: adulTotal,
      preview: preview!,
      previewAnns,
      stainDrift,
    });
    setRunning(false);
    setStatus('完成');
  };

  return (
    <div className="tab-body">
      <section className="card">
        <h2>合成测试集(按药典形态参数化生成,自带 GT)</h2>
        <p className="hint">
          生成器参数化簇晶棱角尖钝、石细胞纹孔疏密、导管五类纹式,并注入气泡、结构重叠、
          组织碎屑、噪点与染色漂移。识别准确率目标 ≥90%。
        </p>
        <div className="row">
          <label>
            测试张数
            <input
              type="number" min={1} max={100} value={nImages}
              onChange={(e) => setNImages(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            />
          </label>
          <label>
            场景
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="normal">常规制片(气泡+重叠+碎屑)</option>
              <option value="stain">染色强漂移(换检验员鲁棒性)</option>
              <option value="adulterate">掺伪样品(两味药混排)</option>
            </select>
          </label>
          <button className="btn primary" disabled={running} onClick={runBatch}>
            {running ? `运行中 ${status}` : '生成并评测'}
          </button>
        </div>
      </section>

      {result && (
        <>
          <section className="card">
            <h2>总体指标</h2>
            <div className="metric-grid big">
              <div className={`metric ${result.report.overallAccuracy >= 0.9 ? 'good' : 'bad'}`}>
                <span className="metric-name">结构识别综合准确率</span>
                <span className="metric-value">{(result.report.overallAccuracy * 100).toFixed(1)}%</span>
                <span className="metric-sub">目标 ≥90%</span>
              </div>
              <div className="metric">
                <span className="metric-name">Macro-F1</span>
                <span className="metric-value">{(result.report.macroF1 * 100).toFixed(1)}%</span>
              </div>
              <div className="metric">
                <span className="metric-name">平均 IoU</span>
                <span className="metric-value">{(result.report.meanIoU * 100).toFixed(1)}%</span>
              </div>
              <div className="metric">
                <span className="metric-name">药材 Top-1 命中</span>
                <span className="metric-value">{result.herbTop1}/{result.herbTotal}</span>
              </div>
              {result.adulterationTotal > 0 && (
                <div className={`metric ${result.adulterationHits / result.adulterationTotal >= 0.7 ? 'good' : 'bad'}`}>
                  <span className="metric-name">掺伪第二成分识别</span>
                  <span className="metric-value">
                    {result.adulterationHits}/{result.adulterationTotal}
                  </span>
                </div>
              )}
              <div className="metric">
                <span className="metric-name">单图平均耗时</span>
                <span className="metric-value">
                  {(result.perImageMs.reduce((a, b) => a + b, 0) / result.perImageMs.length).toFixed(0)}ms
                </span>
                <span className="metric-sub">
                  30 张预估 {((result.perImageMs.reduce((a, b) => a + b, 0) / result.perImageMs.length) * 30 / 1000).toFixed(1)}s
                </span>
              </div>
            </div>
            <p className="hint">
              细属性误差:簇晶棱角锐度 MAE={result.report.attributeErrors.crystalSharpnessMAE.toFixed(3)}
              ,石细胞纹孔密度 MAE={result.report.attributeErrors.pitDensityMAE.toFixed(3)}
              {mode === 'stain' && `;本批染色漂移 色相 ${result.stainDrift.hue}° / 亮度系数 ${result.stainDrift.brightness}`}
            </p>
          </section>

          <section className="card">
            <h2>分类别指标</h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>结构类型</th><th>TP</th><th>FP</th><th>FN</th>
                  <th>精确率</th><th>召回率</th><th>F1</th><th>分类正确率</th>
                </tr>
              </thead>
              <tbody>
                {result.report.perClass.map((c) => (
                  <tr key={c.type}>
                    <td>{STRUCTURE_LABELS[c.type]}</td>
                    <td>{c.tp}</td><td>{c.fp}</td><td>{c.fn}</td>
                    <td>{(c.precision * 100).toFixed(1)}%</td>
                    <td>{(c.recall * 100).toFixed(1)}%</td>
                    <td>{(c.f1 * 100).toFixed(1)}%</td>
                    <td>{(c.classificationAccuracy * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>计数误差(GT → 预测)</h3>
            <div className="count-errors">
              {result.report.countError.map((c) => (
                <span key={c.type} className={`chip ${c.gt === c.pred ? 'ok' : 'warn'}`}>
                  {STRUCTURE_LABELS[c.type]}: {c.gt} → {c.pred}
                </span>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>首图识别效果预览</h2>
            <PreviewCanvas synth={result.preview} anns={result.previewAnns} />
          </section>
        </>
      )}
    </div>
  );
}

function PreviewCanvas({
  synth,
  anns,
}: {
  synth: SyntheticImage;
  anns: BatchResult['previewAnns'];
}) {
  return (
    <AnnotationCanvas
      image={synth.canvas}
      annotations={anns}
      onChange={() => undefined}
      readOnly
    />
  );
}
