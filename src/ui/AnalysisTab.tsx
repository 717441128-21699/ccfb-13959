import { useState } from 'react';
import { useApp, type ImageEntry } from '../state/AppContext';
import { analyzeImage } from '../cv/pipeline';
import { identifySample } from '../cv/matcher';
import type { Annotation, ImageAnalysis, SampleVerdict, StructureType } from '../types';
import { STRUCTURE_LABELS } from '../types';
import { AnnotationCanvas } from './AnnotationCanvas';

const ALL_TYPES: StructureType[] = [
  'calcium_cluster', 'calcium_needle', 'stone_cell',
  'vessel', 'fiber', 'starch', 'pollen',
];

async function loadFiles(files: FileList): Promise<ImageEntry[]> {
  const entries: ImageEntry[] = [];
  for (const f of Array.from(files)) {
    const bitmap = await createImageBitmap(f);
    entries.push({
      id: `${f.name}-${Date.now()}-${entries.length}`,
      name: f.name,
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
    });
  }
  return entries;
}

export function AnalysisTab() {
  const { images, setImages, profiles, settings, manualEdits, setManualEdits } = useApp();
  const [analyses, setAnalyses] = useState<ImageAnalysis[]>([]);
  const [verdict, setVerdict] = useState<SampleVerdict | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError('');
    try {
      const loaded = await loadFiles(files);
      setImages([...images, ...loaded].slice(0, settings.imageBudget));
    } catch (e) {
      setError('图片读取失败: ' + (e as Error).message);
    }
  };

  const runAll = async () => {
    if (images.length === 0) {
      setError('请先导入显微照片');
      return;
    }
    setRunning(true);
    setError('');
    const t0 = performance.now();
    const results: ImageAnalysis[] = [];
    for (let i = 0; i < images.length; i++) {
      setProgress(`正在分析第 ${i + 1}/${images.length} 张:${images[i].name}`);
      // 让 UI 有机会刷新
      await new Promise((r) => setTimeout(r, 0));
      const a = analyzeImage(images[i].bitmap, images[i].id, settings.thresholdC);
      const edits = manualEdits[images[i].id];
      if (edits) {
        // 人工标注覆盖:以人工结果重算计数
        a.annotations = edits;
        const counts = { ...a.counts };
        for (const t of ALL_TYPES) counts[t] = 0;
        for (const ann of edits) counts[ann.type]++;
        a.counts = counts;
      }
      results.push(a);
      if (performance.now() - t0 > settings.timeBudgetMs) {
        setError(`超过 ${settings.timeBudgetMs / 1000}s 时间预算,已提前停止于第 ${i + 1} 张`);
        break;
      }
    }
    setAnalyses(results);
    const v = identifySample(results, profiles);
    v.totalTimeMs = performance.now() - t0;
    setVerdict(v);
    setActiveIdx(0);
    setProgress('');
    setRunning(false);
  };

  const current = images[activeIdx];
  const currentAnalysis = analyses[activeIdx];
  const currentAnns: Annotation[] = currentAnalysis
    ? (manualEdits[current.id] ?? currentAnalysis.annotations)
    : [];

  return (
    <div className="tab-body">
      <section className="card">
        <h2>1. 导入显微照片(单样品最多 {settings.imageBudget} 张,目标 {settings.timeBudgetMs / 1000}s 内出结果)</h2>
        <div className="row">
          <label className="btn primary file-btn">
            选择照片 / 拖拽到此处
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => onUpload(e.target.files)}
            />
          </label>
          <button className="btn" disabled={running} onClick={runAll}>
            {running ? '分析中…' : `开始 GPU 识别与鉴定(${images.length} 张)`}
          </button>
          {images.length > 0 && (
            <button className="btn ghost" onClick={() => { setImages([]); setAnalyses([]); setVerdict(null); }}>
              清空样品
            </button>
          )}
        </div>
        {progress && <p className="progress">{progress}</p>}
        {error && <p className="error">{error}</p>}
        {images.length > 0 && (
          <div className="thumbs">
            {images.map((img, i) => (
              <button
                key={img.id}
                className={`thumb ${i === activeIdx ? 'active' : ''}`}
                onClick={() => setActiveIdx(i)}
                title={img.name}
              >
                <img src={bitmapToUrl(img.bitmap)} alt={img.name} />
                <span>{i + 1}. {img.name.length > 14 ? img.name.slice(0, 13) + '…' : img.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {current && currentAnalysis && (
        <section className="card">
          <h2>2. 结构识别与人工复核(改标注后重跑鉴定即生效)</h2>
          <AnnotationCanvas
            image={current.bitmap}
            annotations={currentAnns}
            onChange={(anns) => setManualEdits(current.id, anns)}
          />
          <div className="metric-grid">
            {ALL_TYPES.map((t) => (
              <div key={t} className="metric">
                <span className="metric-name">{STRUCTURE_LABELS[t]}</span>
                <span className="metric-value">{currentAnalysis.counts[t]}</span>
              </div>
            ))}
          </div>
          <TimingTable analysis={currentAnalysis} />
        </section>
      )}

      {verdict && (
        <section className="card">
          <h2>3. 药典比对鉴定结果</h2>
          <p className="verdict-time">
            样品总耗时 <b>{(verdict.totalTimeMs / 1000).toFixed(1)}s</b> / 预算 {settings.timeBudgetMs / 1000}s
            {verdict.totalTimeMs <= settings.timeBudgetMs ? ' ✅ 达标' : ' ⚠ 超时'}
          </p>
          <div className="match-list">
            {verdict.matches.map((m, i) => (
              <div key={m.herbId} className={`match ${i === 0 ? 'top' : ''}`}>
                <div className="match-head">
                  <span className="match-rank">#{i + 1}</span>
                  <span className="match-name">{m.herbName}</span>
                  <span className="match-score">{(m.score * 100).toFixed(1)}%</span>
                </div>
                <ul className="evidence">
                  {m.evidence.map((e, j) => <li key={j}>{e}</li>)}
                  {m.missingHallmarks.map((e, j) => (
                    <li key={`m${j}`} className="missing">未检出标志特征:{e}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className={`adulteration ${verdict.adulteration.detected ? 'warn' : 'ok'}`}>
            <h3>掺伪判断</h3>
            <p>
              {verdict.adulteration.detected ? '⚠ 疑似掺伪' : '未发现明确掺伪证据'}
              {verdict.adulteration.secondaryHerbName ? `:第二成分疑似 ${verdict.adulteration.secondaryHerbName}` : ''}
            </p>
            <p className="reason">{verdict.adulteration.reason}</p>
            {verdict.adulteration.supportingTypes.length > 0 && (
              <p>支撑结构类型:
                {verdict.adulteration.supportingTypes.map((t) => STRUCTURE_LABELS[t]).join('、')}
              </p>
            )}
          </div>
          <h3>全样品结构计数汇总</h3>
          <div className="metric-grid">
            {ALL_TYPES.map((t) => (
              <div key={t} className="metric">
                <span className="metric-name">{STRUCTURE_LABELS[t]}</span>
                <span className="metric-value">{verdict.aggregateCounts[t]}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TimingTable({ analysis }: { analysis: ImageAnalysis }) {
  const entries = Object.entries(analysis.timings);
  return (
    <details className="timing">
      <summary>GPU 各阶段耗时(ms)</summary>
      <table>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}><td>{k}</td><td>{v.toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function bitmapToUrl(b: ImageBitmap): string {
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 90;
  c.getContext('2d')!.drawImage(b, 0, 0, 120, 90);
  return c.toDataURL();
}
