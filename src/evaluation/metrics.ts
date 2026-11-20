/**
 * 识别评测:把自动标注与合成图 GT 做 IoU 匹配,输出
 * 每类 precision/recall、分类准确率、细粒度属性(锐度/纹孔密度)误差与混淆矩阵。
 */
import type { Annotation, StructureType } from '../types';
import type { GtObject } from '../synthetic/generator';

export interface ClassMetric {
  type: StructureType;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  /** 匹配成功且类别正确 / 匹配成功总数 */
  classificationAccuracy: number;
}

export interface EvalReport {
  perClass: ClassMetric[];
  /** 总体:正确类别且 IoU 达标 / GT 总数 */
  overallAccuracy: number;
  macroF1: number;
  meanIoU: number;
  confusion: Record<string, Record<string, number>>;
  attributeErrors: {
    crystalSharpnessMAE: number;
    pitDensityMAE: number;
    n: number;
  };
  countError: { type: StructureType; gt: number; pred: number }[];
}

const ALL_TYPES: StructureType[] = [
  'calcium_cluster', 'calcium_needle', 'stone_cell',
  'vessel', 'fiber', 'starch', 'pollen',
];

export function iou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union === 0 ? 0 : inter / union;
}

/** 中心点距离兜底匹配(分割掩膜 bbox 与绘制 bbox 尺寸可能不一致)。 */
function centerDist(a: Annotation, g: GtObject): number {
  return Math.hypot(a.cx - g.cx, a.cy - g.cy);
}

const CENTER_TOLERANCE = 75; // 1024 宽图像上约 7% 画幅,容忍分割中心偏移

export function evaluate(
  gt: GtObject[],
  annotations: Annotation[],
  regions: { id: number; crystalSharpness?: number; pitDensity?: number; bbox: Annotation['bbox']; cx: number; cy: number }[],
  iouThreshold = 0.15,
): EvalReport {
  const usedGt = new Set<number>();
  const perClassMap = new Map<StructureType, { tp: number; fp: number; fn: number; correct: number; matched: number }>();
  for (const t of ALL_TYPES) perClassMap.set(t, { tp: 0, fp: 0, fn: 0, correct: 0, matched: 0 });
  const confusion: Record<string, Record<string, number>> = {};
  const ious: number[] = [];
  const sharpErr: number[] = [];
  const pitErr: number[] = [];

  // 全局最优贪心匹配:收集所有可行 (预测,GT) 候选对,按质量降序一一配对,
  // 避免多个预测争抢同一 GT;同类 + 高 IoU 优先
  const candidates: { annIdx: number; gtIdx: number; score: number }[] = [];
  annotations.forEach((ann, ai) => {
    gt.forEach((g, gi) => {
      const v = iou(ann.bbox, g.bbox);
      const dist = centerDist(ann, g);
      if (v < iouThreshold && dist >= CENTER_TOLERANCE) return;
      candidates.push({
        annIdx: ai, gtIdx: gi,
        score: v + (g.type === annotations[ai].type ? 0.5 : 0) - dist / 10000,
      });
    });
  });
  candidates.sort((a, b) => b.score - a.score);
  const usedAnn = new Set<number>();

  for (const cand of candidates) {
    if (usedAnn.has(cand.annIdx) || usedGt.has(cand.gtIdx)) continue;
    usedAnn.add(cand.annIdx);
    usedGt.add(cand.gtIdx);
    const ann = annotations[cand.annIdx];
    const g = gt[cand.gtIdx];
    ious.push(iou(ann.bbox, g.bbox));
    const cls = perClassMap.get(ann.type)!;
    cls.matched++;
    if (g.type === ann.type) {
      cls.tp++;
      cls.correct++;
    } else {
      cls.fp++;
      const gtCls = perClassMap.get(g.type)!;
      gtCls.fn++;
      confusion[g.type] = confusion[g.type] ?? {};
      confusion[g.type][ann.type] = (confusion[g.type][ann.type] ?? 0) + 1;
    }
    // 细属性误差
    const region = regions.find((r) =>
      Math.abs(r.cx - ann.cx) < 2 && Math.abs(r.cy - ann.cy) < 2);
    if (region) {
      if (g.type === 'calcium_cluster' && region.crystalSharpness !== undefined &&
        typeof g.params.sharpness === 'number') {
        sharpErr.push(Math.abs(region.crystalSharpness - g.params.sharpness));
      }
      if (g.type === 'stone_cell' && region.pitDensity !== undefined &&
        typeof g.params.pitDensity === 'number') {
        pitErr.push(Math.abs(region.pitDensity - g.params.pitDensity));
      }
    }
  }

  // 未匹配的预测 = 误检
  for (let ai = 0; ai < annotations.length; ai++) {
    if (!usedAnn.has(ai)) perClassMap.get(annotations[ai].type)!.fp++;
  }
  for (let i = 0; i < gt.length; i++) {
    if (!usedGt.has(i)) perClassMap.get(gt[i].type)!.fn++;
  }

  const perClass: ClassMetric[] = [];
  let totalTp = 0;
  let totalGt = 0;
  let f1Sum = 0;
  for (const t of ALL_TYPES) {
    const m = perClassMap.get(t)!;
    const precision = m.tp + m.fp === 0 ? 0 : m.tp / (m.tp + m.fp);
    const recall = m.tp + m.fn === 0 ? (m.tp === 0 ? 1 : 0) : m.tp / (m.tp + m.fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClass.push({
      type: t, tp: m.tp, fp: m.fp, fn: m.fn,
      precision: round4(precision), recall: round4(recall), f1: round4(f1),
      classificationAccuracy: m.matched === 0 ? 1 : round4(m.correct / m.matched),
    });
    totalTp += m.tp;
    totalGt += gt.filter((g) => g.type === t).length;
    f1Sum += f1;
  }

  return {
    perClass,
    overallAccuracy: gt.length === 0 ? 0 : round4(totalTp / totalGt),
    macroF1: round4(f1Sum / ALL_TYPES.length),
    meanIoU: ious.length ? round4(ious.reduce((a, b) => a + b, 0) / ious.length) : 0,
    confusion,
    attributeErrors: {
      crystalSharpnessMAE: sharpErr.length ? round4(sharpErr.reduce((a, b) => a + b, 0) / sharpErr.length) : 0,
      pitDensityMAE: pitErr.length ? round4(pitErr.reduce((a, b) => a + b, 0) / pitErr.length) : 0,
      n: sharpErr.length + pitErr.length,
    },
    countError: ALL_TYPES.map((t) => ({
      type: t,
      gt: gt.filter((g) => g.type === t).length,
      pred: annotations.filter((a) => a.type === t).length,
    })),
  };
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
