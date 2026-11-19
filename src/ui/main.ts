import { EditHistory, TYPE_COLORS, addObjectOp, changeTypeOp, deleteObjectsOp, editableTypes } from './annotationEditor';
import { runEvaluation } from './evalRunner';
import { detectImage } from '../core/detectionService';
import { matchDrugs, detectMixture } from '../core/matcher';
import { DEFAULT_PARAMS, type PipelineParams } from '../core/gpuPipeline';
import { DRUG_PROFILES, DRUG_MAP } from '../core/knowledgeBase';
import { recount } from '../core/classifier';
import { STRUCTURE_LABEL, type DetectedObject, type SampleReport, type StructureType } from '../core/types';
import { GpuEngine } from '../gpu/GpuEngine';
import { STAIN_PRESETS } from '../synthetic/primitives';
import { generateSyntheticImage, WORK_SIZE } from '../synthetic/syntheticGenerator';
import type { EvalReport } from '../core/evaluation';

interface ImageTab {
  id: number;
  name: string;
  sourceCanvas: HTMLCanvasElement;
  report: SampleReport | null;
  history: EditHistory;
  gt?: { type: StructureType; x: number; y: number; radius: number }[];
  isSynthetic: boolean;
  actualDrugIds: string[];
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

let engine: GpuEngine | null = null;
let tabs: ImageTab[] = [];
let activeTabId = 0;
let tabSeq = 1;
let labelsVisible = true;
let selectedObjectId: number | null = null;
let addingMode: StructureType | null = null;
let drawPoints: { x: number; y: number }[] = [];

const glCanvas = $<HTMLCanvasElement>('glCanvas');
const displayCanvas = $<HTMLCanvasElement>('displayCanvas');
const displayCtx = displayCanvas.getContext('2d')!;
const overlayCanvas = $<HTMLCanvasElement>('overlayCanvas');
const overlayCtx = overlayCanvas.getContext('2d')!;

function toast(msg: string, ms = 2600): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), ms);
}

function activeTab(): ImageTab | undefined {
  return tabs.find((t) => t.id === activeTabId);
}

// ---------- 初始化 ----------
function initControls(): void {
  for (const d of DRUG_PROFILES) {
    for (const sel of ['drugSelect', 'drugSelectB']) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      $(sel).appendChild(opt);
    }
  }
  ($('drugSelectB') as HTMLSelectElement).value = DRUG_PROFILES[1].id;
  for (const s of STAIN_PRESETS) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    $('stainSelect').appendChild(opt);
  }

  $('fileInput').addEventListener('change', onFilesSelected);
  $('genBtn').addEventListener('click', () => generateOne());
  $('genBatchBtn').addEventListener('click', () => generateBatch());
  $('evalBtn').addEventListener('click', () => runEval(30));
  $('evalStressBtn').addEventListener('click', () => runEval(60));
  $('rerunBtn').addEventListener('click', () => rerunActive());
  $('undoBtn').addEventListener('click', () => applyHistory('undo'));
  $('redoBtn').addEventListener('click', () => applyHistory('redo'));
  $('toggleLabelsBtn').addEventListener('click', toggleLabels);

  for (const [rangeId, valId] of [
    ['threshRange', 'threshVal'],
    ['edgeRange', 'edgeVal'],
    ['minAreaRange', 'minAreaVal'],
  ] as const) {
    $(rangeId).addEventListener('input', () => {
      $(valId).textContent = ($(rangeId) as HTMLInputElement).value;
    });
  }
  overlayCanvas.addEventListener('click', onOverlayClick);
  overlayCanvas.addEventListener('dblclick', onOverlayDblClick);
}

function initGpu(): void {
  try {
    engine = new GpuEngine(glCanvas, WORK_SIZE, WORK_SIZE);
    const chip = $('gpuStatus');
    chip.textContent = 'GPU WebGL2 浮点管线就绪';
    chip.className = 'chip chip-ok';
  } catch (e) {
    const chip = $('gpuStatus');
    chip.textContent = 'GPU 不可用：' + (e as Error).message;
    chip.className = 'chip chip-bad';
  }
}

// ---------- 参数 ----------
function currentParams(): PipelineParams {
  return {
    ...DEFAULT_PARAMS,
    workSize: WORK_SIZE,
    globalThresh: parseFloat(($('threshRange') as HTMLInputElement).value),
    edgeThresh: parseFloat(($('edgeRange') as HTMLInputElement).value),
    minAreaPx: parseInt(($('minAreaRange') as HTMLInputElement).value, 10),
  };
}

function currentScale(): number {
  return parseFloat(($('scaleInput') as HTMLInputElement).value) || 0.5;
}

// ---------- 图像导入与生成 ----------
async function onFilesSelected(ev: Event): Promise<void> {
  if (!engine) return toast('GPU 尚未就绪');
  const files = Array.from((ev.target as HTMLInputElement).files ?? []);
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    addTab(file.name, c, false, []);
  }
  (ev.target as HTMLInputElement).value = '';
  if (tabs.length) await runDetection(activeTab()!);
}

function pickStain() {
  const v = ($('stainSelect') as HTMLSelectElement).value;
  return v === 'random' ? STAIN_PRESETS[Math.floor(Math.random() * STAIN_PRESETS.length)] : STAIN_PRESETS.find((s) => s.id === v)!;
}

function generateOne(): SampleReport | null {
  if (!engine) {
    toast('GPU 尚未就绪');
    return null;
  }
  const seed = parseInt(($('seedInput') as HTMLInputElement).value, 10) + tabSeq * 7;
  const drugA = DRUG_MAP[($('drugSelect') as HTMLSelectElement).value];
  const isMix = ($('mixtureToggle') as HTMLInputElement).checked;
  const drugB = DRUG_MAP[($('drugSelectB') as HTMLSelectElement).value];
  const sample = generateSyntheticImage({
    drugs: isMix ? [drugA, drugB] : [drugA],
    seed,
    stain: pickStain(),
  });
  const name = isMix ? `合成·${drugA.name}+${drugB.name}#${tabSeq}` : `合成·${drugA.name}#${tabSeq}`;
  const tab = addTab(name, sample.canvas, true, sample.drugs, sample.groundTruth);
  void tab;
  return null;
}

async function generateBatch(): Promise<void> {
  if (!engine) return;
  const baseSeed = parseInt(($('seedInput') as HTMLInputElement).value, 10);
  for (let i = 0; i < 30; i++) {
    const isMix = i % 3 === 2;
    const drugA = DRUG_PROFILES[(baseSeed + i) % DRUG_PROFILES.length];
    const drugB = DRUG_PROFILES[(baseSeed + i * 7) % DRUG_PROFILES.length];
    const sample = generateSyntheticImage({
      drugs: isMix ? [drugA, drugB] : [drugA],
      seed: baseSeed + i * 131,
      stain: STAIN_PRESETS[i % STAIN_PRESETS.length],
    });
    addTab(`批次${String(i + 1).padStart(2, '0')}·${drugA.name}${isMix ? '+' + drugB.name : ''}`, sample.canvas, true, sample.drugs, sample.groundTruth);
    await new Promise((r) => setTimeout(r, 0));
  }
  toast('30 张测试图已生成，开始逐张鉴别…');
  for (const tab of tabs.slice(-30)) {
    activeTabId = tab.id;
    await runDetection(tab, true);
  }
  renderAll();
  summarizeBatch(tabs.slice(-30));
}

function addTab(
  name: string,
  sourceCanvas: HTMLCanvasElement,
  isSynthetic: boolean,
  actualDrugIds: string[],
  gt?: ImageTab['gt'],
): ImageTab {
  const tab: ImageTab = {
    id: tabSeq++,
    name,
    sourceCanvas,
    report: null,
    history: new EditHistory(),
    gt,
    isSynthetic,
    actualDrugIds,
  };
  tabs.push(tab);
  activeTabId = tab.id;
  renderTabs();
  $('emptyHint').classList.add('hidden');
  return tab;
}

// ---------- 检测 ----------
async function runDetection(tab: ImageTab, silent = false): Promise<void> {
  if (!engine) return;
  if (!silent) $('statusText').textContent = `正在鉴别 ${tab.name} …`;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 0));
  try {
    const report = detectImage(engine, tab.sourceCanvas, {
      scaleUmPerPx: currentScale(),
      params: currentParams(),
    });
    report.imageName = tab.name;
    tab.report = report;
    selectedObjectId = null;
    if (!silent) {
      $('statusText').textContent = `鉴别完成：${tab.name}`;
      $('timingText').textContent =
        `GPU ${report.result.gpuMs.toFixed(0)}ms · CPU ${report.result.cpuMs.toFixed(0)}ms · 共 ${report.result.timingMs.toFixed(0)}ms · ${report.result.objects.length} 个目标`;
    }
    renderAll();
  } catch (e) {
    $('statusText').textContent = '鉴别失败：' + (e as Error).message;
  }
  void t0;
}

function rerunActive(): void {
  const tab = activeTab();
  if (tab) void runDetection(tab);
}

// ---------- 历史编辑 ----------
function objects(): DetectedObject[] {
  return activeTab()?.report?.result.objects ?? [];
}

function commit(op: ReturnType<typeof changeTypeOp>): void {
  const tab = activeTab();
  if (!tab?.report) return;
  tab.report.result.objects = tab.history.push(op, tab.report.result.objects);
  tab.report.result.counts = recount(tab.report.result.objects);
  // 编辑后重算药材匹配
  tab.report.matches = matchDrugs(tab.report.result.objects);
  tab.report.mixture = detectMixture(tab.report.result.objects, tab.report.matches);
  renderAll();
}

function applyHistory(kind: 'undo' | 'redo'): void {
  const tab = activeTab();
  if (!tab?.report) return;
  tab.report.result.objects = kind === 'undo' ? tab.history.undo(tab.report.result.objects) : tab.history.redo(tab.report.result.objects);
  tab.report.result.counts = recount(tab.report.result.objects);
  tab.report.matches = matchDrugs(tab.report.result.objects);
  tab.report.mixture = detectMixture(tab.report.result.objects, tab.report.matches);
  renderAll();
}

function toggleLabels(): void {
  labelsVisible = !labelsVisible;
  $('toggleLabelsBtn').textContent = labelsVisible ? '隐藏标注' : '显示标注';
  drawOverlay();
}

// ---------- 画布交互 ----------
function canvasPoint(ev: MouseEvent): { x: number; y: number } {
  const rect = overlayCanvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * WORK_SIZE;
  const y = ((ev.clientY - rect.top) / rect.height) * WORK_SIZE;
  return { x, y };
}

function hitTest(p: { x: number; y: number }): DetectedObject | null {
  let hit: DetectedObject | null = null;
  for (const o of objects()) {
    if (o.hidden) continue;
    let inside = false;
    const poly = o.polygon;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x,
        yi = poly[i].y;
      const xj = poly[j].x,
        yj = poly[j].y;
      if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) hit = o;
  }
  return hit;
}

function onOverlayClick(ev: MouseEvent): void {
  const p = canvasPoint(ev);
  if (addingMode) {
    drawPoints.push(p);
    drawOverlay();
    return;
  }
  const hit = hitTest(p);
  selectedObjectId = hit ? hit.id : null;
  renderAll();
}

function onOverlayDblClick(_ev: MouseEvent): void {
  if (!addingMode || drawPoints.length < 3) return;
  const tab = activeTab();
  if (!tab?.report) return;
  const xs = drawPoints.map((p) => p.x);
  const ys = drawPoints.map((p) => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs);
  const minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const area = polygonAreaShim(drawPoints);
  const equiv = 2 * Math.sqrt(area / Math.PI);
  const stub: Omit<DetectedObject, 'id' | 'edited'> = {
    type: addingMode,
    confidence: 1,
    typeScores: { [addingMode]: 1 } as Partial<Record<StructureType, number>>,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    centroid: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    polygon: drawPoints,
    features: blankFeatures(area, equiv),
    diameterUm: equiv * currentScale(),
    lengthUm: (maxY - minY) * currentScale(),
    overlapped: false,
    hidden: false,
  };
  commit(addObjectOp(stub));
  addingMode = null;
  drawPoints = [];
  toast('已新增标注，双击其他目标可继续选择操作');
}

function polygonAreaShim(poly: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(s) / 2;
}

function blankFeatures(area: number, equiv: number): DetectedObject['features'] {
  return {
    areaPx: area,
    perimeterPx: Math.sqrt(area) * 3.5,
    equivDiameterPx: equiv,
    majorAxisPx: equiv,
    minorAxisPx: equiv,
    aspectRatio: 1,
    circularity: 0.8,
    solidity: 0.9,
    convexity: 0.9,
    eccentricity: 0.3,
    extent: 0.8,
    radialSymmetry: 0.8,
    wallRatio: 0.3,
    lumenRatio: 0.5,
    tipAngles: [],
    tipCount: 0,
    tipSharpness: 0,
    pitDensity: 0,
    ridgeDensity: 0,
    patternScore: { reticulate: 0, pitted: 0, bordered_pitted: 0, spiral: 0, annular: 0 },
    hilum: false,
    cleft: false,
    spiny: false,
    meanDensity: 0.4,
    textureEnergy: 0.05,
    interiorEnergy: 0.1,
    rimEnergy: 0.2,
  };
}

// ---------- 渲染 ----------
function renderTabs(): void {
  const wrap = $('imageTabs');
  wrap.innerHTML = '';
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === activeTabId ? ' active' : '');
    el.textContent = t.name.length > 18 ? t.name.slice(0, 17) + '…' : t.name;
    el.title = t.name;
    el.addEventListener('click', () => {
      activeTabId = t.id;
      selectedObjectId = null;
      renderAll();
    });
    wrap.appendChild(el);
  }
}

function drawSource(): void {
  const tab = activeTab();
  if (!tab) return;
  const ctx = displayCtx;
  ctx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
  const c = tab.sourceCanvas;
  const scale = Math.min(WORK_SIZE / c.width, WORK_SIZE / c.height);
  const w = c.width * scale;
  const h = c.height * scale;
  ctx.drawImage(c, (WORK_SIZE - w) / 2, (WORK_SIZE - h) / 2, w, h);
}

function drawOverlay(): void {
  overlayCtx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
  const tab = activeTab();
  if (!tab?.report || !labelsVisible) return;
  for (const o of tab.report.result.objects) {
    if (o.hidden) continue;
    const color = TYPE_COLORS[o.type];
    overlayCtx.beginPath();
    const poly = o.polygon;
    overlayCtx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) overlayCtx.lineTo(poly[i].x, poly[i].y);
    overlayCtx.closePath();
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = o.id === selectedObjectId ? 3 : 1.6;
    overlayCtx.stroke();
    overlayCtx.fillStyle = color + '22';
    overlayCtx.fill();
    const label = `${STRUCTURE_LABEL[o.type]}${o.subtype ? '·' + o.subtype : ''} ${o.diameterUm.toFixed(0)}μm`;
    overlayCtx.font = '13px Microsoft YaHei, sans-serif';
    const tw = overlayCtx.measureText(label).width + 8;
    const lx = Math.min(o.bbox.x, WORK_SIZE - tw - 4);
    const ly = Math.max(4, o.bbox.y - 18);
    overlayCtx.fillStyle = color;
    overlayCtx.fillRect(lx, ly, tw, 17);
    overlayCtx.fillStyle = '#fff';
    overlayCtx.fillText(label, lx + 4, ly + 13);
    if (o.overlapped) {
      overlayCtx.strokeStyle = '#ffd43b';
      overlayCtx.setLineDash([5, 4]);
      overlayCtx.strokeRect(o.bbox.x - 2, o.bbox.y - 2, o.bbox.w + 4, o.bbox.h + 4);
      overlayCtx.setLineDash([]);
    }
  }
  if (addingMode && drawPoints.length) {
    overlayCtx.fillStyle = TYPE_COLORS[addingMode];
    for (const p of drawPoints) {
      overlayCtx.beginPath();
      overlayCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      overlayCtx.fill();
    }
  }
}

function renderMatches(): void {
  const tab = activeTab();
  const list = $('matchList');
  list.innerHTML = '';
  const mixBox = $('mixtureBox');
  if (!tab?.report) {
    mixBox.classList.add('hidden');
    return;
  }
  const mix = tab.report.mixture;
  if (mix.detected) {
    mixBox.classList.remove('hidden');
    mixBox.classList.add('alert');
    mixBox.innerHTML = `<h3>⚠ 检出掺伪/混合样品（置信度 ${(mix.confidence * 100).toFixed(0)}%）</h3>
      <div>推断组分：${mix.components.join('、') || '待人工确认'}</div>
      <div style="margin-top:4px;color:#7a4a00">${mix.reason}</div>`;
  } else {
    mixBox.classList.remove('alert');
    mixBox.classList.remove('hidden');
    mixBox.innerHTML = `<h3>未检出掺伪</h3><div style="color:#555">${mix.reason}</div>`;
  }
  tab.report.matches.slice(0, 6).forEach((m, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="drug-name">${idx + 1}. ${m.drugName}</span>
      <span class="match-score">${(m.score * 100).toFixed(1)}%</span>
      <div class="match-bar"><i style="width:${(m.score * 100).toFixed(1)}%"></i></div>`;
    li.addEventListener('click', () => renderEvidence(m.drugId));
    list.appendChild(li);
  });
}

function renderEvidence(drugId: string): void {
  const tab = activeTab();
  const box = $('evidenceBox');
  if (!tab?.report) return;
  const m = tab.report.matches.find((x) => x.drugId === drugId);
  if (!m) return;
  const profile = DRUG_MAP[drugId];
  const html: string[] = [`<strong>${profile.name}（${profile.latin}）</strong>`, `<div style="color:#666;margin:4px 0 8px">鉴别要点：${profile.keyTraits.join('；')}</div>`];
  for (const e of m.evidence) {
    html.push(`<div class="evidence-line ${e.hit ? 'hit' : 'miss'}"><span class="mark">${e.hit ? '✓' : '✗'}</span><span>${e.text}</span></div>`);
  }
  for (const e of m.missing) {
    html.push(`<div class="evidence-line miss"><span class="mark">✗</span><span>${e.text}</span></div>`);
  }
  box.innerHTML = html.join('');
}

function renderCounts(): void {
  const tab = activeTab();
  const table = $('countTable');
  if (!tab?.report) {
    table.innerHTML = '';
    return;
  }
  const counts = tab.report.result.counts;
  const rows: string[] = ['<tr><th>结构类型</th><th>个数</th><th>示例测量</th></tr>'];
  const objs = tab.report.result.objects;
  for (const t of Object.keys(counts) as StructureType[]) {
    if (counts[t] === 0) continue;
    const sample = objs.find((o) => o.type === t && !o.hidden);
    const measure = sample ? `${sample.diameterUm.toFixed(1)}μm${sample.features.tipCount ? ` · 棱角${sample.features.tipCount}` : ''}` : '';
    rows.push(
      `<tr><td><span class="dot" style="background:${TYPE_COLORS[t]}"></span>${STRUCTURE_LABEL[t]}</td><td><strong>${counts[t]}</strong></td><td>${measure}</td></tr>`,
    );
  }
  table.innerHTML = rows.join('');
}

function renderObjectList(): void {
  const tab = activeTab();
  const wrap = $('objectList');
  wrap.innerHTML = '';
  if (!tab?.report) return;
  // 新增模式入口
  const addBar = document.createElement('div');
  addBar.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap';
  for (const t of editableTypes().slice(0, 6)) {
    const b = document.createElement('button');
    b.textContent = '＋' + STRUCTURE_LABEL[t].slice(0, 3);
    b.addEventListener('click', () => {
      addingMode = addingMode === t ? null : t;
      drawPoints = [];
      toast(addingMode ? `在图上单击描点、双击闭合完成「${STRUCTURE_LABEL[t]}」新增` : '已取消新增');
      drawOverlay();
    });
    addBar.appendChild(b);
  }
  wrap.appendChild(addBar);

  for (const o of tab.report.result.objects) {
    const row = document.createElement('div');
    row.className = 'obj-row' + (o.id === selectedObjectId ? ' selected' : '') + (o.hidden ? ' hidden-item' : '');
    const left = document.createElement('div');
    left.innerHTML = `<span class="dot" style="background:${TYPE_COLORS[o.type]}"></span>#${o.id} ${STRUCTURE_LABEL[o.type]}
      <div style="color:#8892a0;font-size:11px">Ø${o.diameterUm.toFixed(1)}μm · ${(o.confidence * 100).toFixed(0)}%${o.edited ? ' · 已人工修正' : ''}${o.overlapped ? ' · 重叠' : ''}</div>`;
    left.addEventListener('click', () => {
      selectedObjectId = o.id;
      renderAll();
    });
    const actions = document.createElement('div');
    actions.className = 'obj-actions';
    const sel = document.createElement('select');
    for (const t of editableTypes()) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = STRUCTURE_LABEL[t];
      if (t === o.type) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => commit(changeTypeOp([o.id], sel.value as StructureType)));
    const del = document.createElement('button');
    del.textContent = o.hidden ? '恢复' : '删除';
    del.addEventListener('click', () => {
      if (o.hidden) {
        commit(changeTypeOp([o.id], o.type)); // 恢复可见
        const tab2 = activeTab()!;
        tab2.report!.result.objects = tab2.history.undo(tab2.report!.result.objects);
        tab2.report!.result.counts = recount(tab2.report!.result.objects);
        renderAll();
      } else {
        commit(deleteObjectsOp([o.id]));
      }
    });
    actions.append(sel, del);
    row.append(left, actions);
    wrap.appendChild(row);
  }
}

function renderButtons(): void {
  const tab = activeTab();
  ($('undoBtn') as HTMLButtonElement).disabled = !tab?.history.canUndo;
  ($('redoBtn') as HTMLButtonElement).disabled = !tab?.history.canRedo;
}

function renderAll(): void {
  renderTabs();
  drawSource();
  drawOverlay();
  renderMatches();
  renderCounts();
  renderObjectList();
  renderButtons();
}

// ---------- 批量汇总 ----------
function summarizeBatch(batchTabs: ImageTab[]): void {
  const reports = batchTabs.map((t) => t.report).filter(Boolean) as SampleReport[];
  if (!reports.length) return;
  const total = reports.reduce((a, r) => a + r.result.timingMs, 0);
  const projected30 = (total / reports.length) * 30;
  const chip = $('throughputChip');
  const ok = projected30 <= 120000;
  chip.textContent = `30 张预计 ${(projected30 / 1000).toFixed(1)}s（限值 120s）`;
  chip.className = 'chip ' + (ok ? 'chip-ok' : 'chip-bad');
}

async function runEval(count: number): Promise<void> {
  if (!engine) return toast('GPU 尚未就绪');
  const summary = $('evalSummary');
  summary.innerHTML = '运行中…';
  const baseSeed = parseInt(($('seedInput') as HTMLInputElement).value, 10);
  const { report } = await runEvaluation(engine, count, baseSeed, (p) => {
    summary.innerHTML = `${p.message}<br/>已用时累计中…`;
  });
  renderEvalReport(report);
  const chip = $('throughputChip');
  const ok30 = report.avgImageMs * 30 <= 120000;
  chip.textContent = `30 张实测推算 ${((report.avgImageMs * 30) / 1000).toFixed(1)}s`;
  chip.className = 'chip ' + (ok30 ? 'chip-ok' : 'chip-bad');
  toast(`评测完成：F1 ${(report.micro.f1 * 100).toFixed(1)}% · Top1 ${(report.top1 * 100).toFixed(0)}%`);
}

function renderEvalReport(r: EvalReport): void {
  const accPass = r.micro.f1 >= 0.9 && r.top1 >= 0.9;
  const speedPass = r.avgImageMs * 30 <= 120000;
  const rows = r.perType
    .map(
      (t) =>
        `<tr><td>${STRUCTURE_LABEL[t.type]}</td><td>${t.tp}</td><td>${t.fp}</td><td>${t.fn}</td>
        <td class="${t.precision >= 0.9 ? 'pass' : 'fail'}">${(t.precision * 100).toFixed(1)}%</td>
        <td class="${t.recall >= 0.9 ? 'pass' : 'fail'}">${(t.recall * 100).toFixed(1)}%</td>
        <td class="${t.f1 >= 0.9 ? 'pass' : 'fail'}">${(t.f1 * 100).toFixed(1)}%</td></tr>`,
    )
    .join('');
  $('evalSummary').innerHTML = `
    <div>结构识别 F1：<span class="big ${accPass ? 'pass' : 'fail'}">${(r.micro.f1 * 100).toFixed(1)}%</span>
      （精确率 ${(r.micro.precision * 100).toFixed(1)}% / 召回率 ${(r.micro.recall * 100).toFixed(1)}%）</div>
    <div>药材 Top-1：<strong class="${r.top1 >= 0.9 ? 'pass' : 'fail'}">${(r.top1 * 100).toFixed(1)}%</strong>
      ｜Top-3：<strong>${(r.top3 * 100).toFixed(1)}%</strong></div>
    <div>掺伪检出率：<strong class="${r.mixtureRecall >= 0.85 ? 'pass' : 'fail'}">${(r.mixtureRecall * 100).toFixed(1)}%</strong>
      ｜误报率：<strong>${(r.mixtureFalseRate * 100).toFixed(1)}%</strong></div>
    <div>单张平均 <strong>${r.avgImageMs.toFixed(0)}ms</strong> ｜ P95 ${r.p95ImageMs.toFixed(0)}ms ｜
      30 张推算 <strong class="${speedPass ? 'pass' : 'fail'}">${((r.avgImageMs * 30) / 1000).toFixed(1)}s / 120s</strong></div>
    <div>准确率目标 90%：<span class="${accPass ? 'pass' : 'fail'}">${accPass ? '达标' : '未达标'}</span>
      ｜速度目标：<span class="${speedPass ? 'pass' : 'fail'}">${speedPass ? '达标' : '未达标'}</span></div>
    <table class="confusion" style="width:100%;margin-top:8px">
      <tr><th>类型</th><th>TP</th><th>FP</th><th>FN</th><th>精确率</th><th>召回率</th><th>F1</th></tr>${rows}
    </table>`;
}

// ---------- 启动 ----------
initGpu();
initControls();
renderAll();
