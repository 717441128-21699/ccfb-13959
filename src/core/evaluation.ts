import { STRUCTURE_LABEL, type DetectedObject, type GroundTruthObject, type StructureType } from './types';

export interface DetectionStats {
  tp: number;
  fp: number;
  fn: number;
}

export interface PerTypeStats extends DetectionStats {
  type: StructureType;
  precision: number;
  recall: number;
  f1: number;
}

export interface EvalReport {
  imageCount: number;
  totalGt: number;
  totalDetected: number;
  micro: { precision: number; recall: number; f1: number; accuracy: number };
  perType: PerTypeStats[];
  top1: number;
  top3: number;
  mixtureRecall: number;
  mixtureFalseRate: number;
  avgImageMs: number;
  p95ImageMs: number;
  totalMs: number;
  meetsAccuracyTarget: boolean;
  meetsThroughputTarget: boolean;
  confusion: Partial<Record<StructureType, Partial<Record<StructureType, number>>>>;
}

function iouBBox(a: { x: number; y: number; w: number; h: number }, b: GroundTruthObject['bbox']): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** 贪心最近中心匹配（对分割偏移更稳健），辅以 IoU 门限 */
function matchDetections(
  gt: GroundTruthObject[],
  det: DetectedObject[],
): { pairs: { g: GroundTruthObject; d: DetectedObject }[]; matchedGt: Set<number>; matchedDet: Set<number> } {
  const candidates: { gi: number; di: number; dist: number; iou: number }[] = [];
  for (let gi = 0; gi < gt.length; gi++) {
    for (let di = 0; di < det.length; di++) {
      const g = gt[gi];
      const d = det[di];
      const dist = Math.hypot(g.x - d.centroid.x, g.y - d.centroid.y);
      const iou = iouBBox(d.bbox, g.bbox);
      if (dist < g.radius * 1.6 + 12 || iou > 0.12) {
        candidates.push({ gi, di, dist, iou });
      }
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  const matchedGt = new Set<number>();
  const matchedDet = new Set<number>();
  const pairs: { g: GroundTruthObject; d: DetectedObject }[] = [];
  for (const c of candidates) {
    if (matchedGt.has(c.gi) || matchedDet.has(c.di)) continue;
    matchedGt.add(c.gi);
    matchedDet.add(c.di);
    pairs.push({ g: gt[c.gi], d: det[c.di] });
  }
  return { pairs, matchedGt, matchedDet };
}

const SCORING_TYPES: StructureType[] = [
  'cluster_crystal',
  'prism_crystal',
  'stone_cell',
  'vessel',
  'fiber',
  'crystal_fiber',
  'starch',
  'pollen',
];

export interface ImageEvalInput {
  gt: GroundTruthObject[];
  detected: DetectedObject[];
  actualDrugIds: string[];
  rankedDrugIds: string[];
  isMixture: boolean;
  mixtureDetected: boolean;
  timingMs: number;
}

export function evaluateBatch(inputs: ImageEvalInput[]): EvalReport {
  const perTypeMap = new Map<StructureType, DetectionStats>();
  for (const t of SCORING_TYPES) perTypeMap.set(t, { tp: 0, fp: 0, fn: 0 });
  const confusion: EvalReport['confusion'] = {};
  let totalTp = 0,
    totalFp = 0,
    totalFn = 0,
    totalGt = 0,
    totalDet = 0;
  let top1Hits = 0,
    top3Hits = 0;
  let mixPositive = 0,
    mixHit = 0,
    mixNegative = 0,
    mixFalse = 0;
  const timings: number[] = [];

  for (const img of inputs) {
    const scoringGt = img.gt.filter((g) => SCORING_TYPES.includes(g.type));
    const scoringDet = img.detected.filter((d) => SCORING_TYPES.includes(d.type));
    totalGt += scoringGt.length;
    totalDet += scoringDet.length;
    const { pairs, matchedGt, matchedDet } = matchDetections(scoringGt, scoringDet);
    for (const { g, d } of pairs) {
      const st = perTypeMap.get(g.type)!;
      if (g.type === d.type) {
        st.tp++;
        totalTp++;
      } else {
        st.fn++;
        totalFn++;
        const dst = perTypeMap.get(d.type)!;
        dst.fp++;
        totalFp++;
        confusion[g.type] ??= {};
        confusion[g.type]![d.type] = (confusion[g.type]![d.type] ?? 0) + 1;
      }
    }
    for (let gi = 0; gi < scoringGt.length; gi++) {
      if (!matchedGt.has(gi)) {
        perTypeMap.get(scoringGt[gi].type)!.fn++;
        totalFn++;
      }
    }
    for (let di = 0; di < scoringDet.length; di++) {
      if (!matchedDet.has(di)) {
        perTypeMap.get(scoringDet[di].type)!.fp++;
        totalFp++;
      }
    }
    const hit = img.actualDrugIds.includes(img.rankedDrugIds[0]);
    if (hit) top1Hits++;
    if (img.rankedDrugIds.slice(0, 3).some((id) => img.actualDrugIds.includes(id))) top3Hits++;
    if (img.isMixture) {
      mixPositive++;
      if (img.mixtureDetected) mixHit++;
    } else {
      mixNegative++;
      if (img.mixtureDetected) mixFalse++;
    }
    timings.push(img.timingMs);
  }

  const precision = totalTp / (totalTp + totalFp || 1);
  const recall = totalTp / (totalTp + totalFn || 1);
  const f1 = (2 * precision * recall) / (precision + recall || 1);
  const perType: PerTypeStats[] = [];
  for (const [type, st] of perTypeMap) {
    const p = st.tp / (st.tp + st.fp || 1);
    const r = st.tp / (st.tp + st.fn || 1);
    perType.push({
      type,
      ...st,
      precision: p,
      recall: r,
      f1: (2 * p * r) / (p + r || 1),
    });
  }
  perType.sort((a, b) => a.type.localeCompare(b.type));
  const sortedTimings = [...timings].sort((a, b) => a - b);
  const totalMs = timings.reduce((a, b) => a + b, 0);
  const p95 = sortedTimings[Math.floor(sortedTimings.length * 0.95)] ?? 0;
  const n = inputs.length || 1;

  return {
    imageCount: inputs.length,
    totalGt,
    totalDetected: totalDet,
    micro: {
      precision,
      recall,
      f1,
      accuracy: totalTp / (totalTp + totalFp + totalFn || 1),
    },
    perType,
    top1: top1Hits / n,
    top3: top3Hits / n,
    mixtureRecall: mixPositive ? mixHit / mixPositive : 1,
    mixtureFalseRate: mixNegative ? mixFalse / mixNegative : 0,
    avgImageMs: totalMs / n,
    p95ImageMs: p95,
    totalMs,
    meetsAccuracyTarget: f1 >= 0.9 && top1Hits / n >= 0.9,
    meetsThroughputTarget: totalMs <= 120000 && (totalMs / n) * 30 <= 120000,
    confusion,
  };
}

export function formatPerTypeLabel(t: StructureType): string {
  return STRUCTURE_LABEL[t];
}
