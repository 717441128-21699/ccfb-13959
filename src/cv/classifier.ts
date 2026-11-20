/**
 * 形态学分类器:分层规则决策 + 模糊隶属度打分。
 *
 * 设计依据(由合成测试集 GT 对齐的描述子中位数标定):
 *  - 等径类(AR<3.2):簇晶 d 大、edge 低、顶点多;花粉 edge 高(雕纹)、d 中等;
 *    淀粉 d 小、edge 极低、circ 高;石细胞 luma 低(木质化)、pit 高、壁厚厚。
 *  - 细长类(AR≥3.2):针晶最细且高亮;纤维实心厚壁、edge 低;导管有腔(!solid)、edge 高。
 *
 * 规则阈值集中在本文件,可用「合成测试」页的混淆矩阵继续标定。
 * 分类只用几何/纹理量与白平衡后的亮度,不使用色相 → 染色鲁棒。
 */
import type { RegionFeatures, StructureType } from '../types';

type Vec = Record<StructureType, number>;

function trap(x: number, a: number, b: number, c: number, d: number): number {
  if (x <= a || x >= d) return 0;
  if (x >= b && x <= c) return 1;
  if (x < b) return (x - a) / (b - a);
  return (d - x) / (d - c);
}

const UNKNOWN_THRESHOLD = 0.22;

export function classifyRegion(f: RegionFeatures): {
  type: StructureType | 'unknown';
  confidence: number;
  scores: Partial<Record<StructureType, number>>;
} {
  const s = {} as Vec;
  for (const k of Object.keys({} as Vec)) s[k as StructureType] = 0;

  const ar = f.aspectRatio;
  const circ = f.circularity;
  const d = f.equivDiameter;
  const sharp = f.crystalSharpness ?? 0;
  const verts = f.convexVertices;
  const edge = f.edgeDensity;
  const luma = f.meanNormLuma ?? 0.5;
  const pit = f.pitDensity ?? 0;
  const wlr = f.wallLumenRatio ?? 1;
  const isSolid = f.solidElongated !== false;

  // —— 模糊打分(用于置信度与可解释依据,不直接决定类别)——
  s.calcium_cluster =
    0.26 * trap(ar, 1, 1, 1.5, 2.2) +
    0.20 * trap(d, 22, 30, 90, 130) +
    0.16 * trap(verts, 9, 12, 40, 60) +
    0.14 * trap(luma, 0.6, 0.66, 0.85, 0.95) +
    0.14 * trap(sharp, 0.08, 0.15, 0.6, 0.9) +
    0.10 * (1 - trap(edge, 0.15, 0.25, 0.6, 0.8));

  s.calcium_needle =
    0.45 * trap(ar, 4, 6, 30, 40) +
    0.25 * trap(circ, 0.02, 0.05, 0.4, 0.5) +
    0.15 * (isSolid ? 1 : 0.2) +
    0.15 * trap(luma, 0.6, 0.68, 0.9, 0.98);

  s.stone_cell =
    0.25 * trap(ar, 1, 1, 2.2, 3.2) +
    0.25 * (1 - trap(luma, 0.55, 0.63, 0.85, 0.95)) +
    0.20 * trap(pit, 0.3, 0.5, 1, 1.2) +
    0.15 * trap(wlr, 1.2, 2, 6, 8) +
    0.15 * trap(d, 25, 35, 100, 140);

  s.vessel =
    0.30 * trap(ar, 2.6, 3.4, 12, 18) +
    0.30 * trap(edge, 0.16, 0.24, 0.6, 0.8) +
    0.25 * (isSolid ? 0.15 : 1) +
    0.15 * trap(d, 12, 20, 90, 140);

  s.fiber =
    0.35 * trap(ar, 3.2, 4.5, 20, 35) +
    0.25 * (isSolid ? 1 : 0.2) +
    0.20 * (1 - trap(edge, 0.2, 0.3, 0.6, 0.8)) +
    0.20 * trap(wlr, 1.5, 2.5, 8, 10);

  s.starch =
    0.35 * trap(ar, 1, 1, 1.4, 1.8) +
    0.25 * trap(circ, 0.55, 0.7, 1, 1.1) +
    0.25 * trap(d, 4, 8, 20, 26) +
    0.15 * (1 - trap(edge, 0.08, 0.15, 0.4, 0.6));

  s.pollen =
    0.25 * trap(ar, 1, 1, 1.35, 1.8) +
    0.25 * trap(edge, 0.16, 0.22, 0.5, 0.7) +
    0.25 * trap(d, 12, 18, 38, 48) +
    0.25 * trap(circ, 0.45, 0.6, 1, 1.1);

  // —— 分层规则决策 ——
  let type: StructureType;
  if (ar >= 3.2) {
    // 细长类
    if (ar >= 6 && luma >= 0.62 && circ < 0.3) {
      type = 'calcium_needle'; // 极细长高亮结晶束(优先于导管,针晶也可能有束内边缘)
    } else if (edge >= 0.2 && ar >= 2.6) {
      type = 'vessel'; // 导管内壁有螺纹/网纹/纹孔 → 边缘密度高
    } else {
      type = 'fiber'; // 实心厚壁、低纹理长条
    }
  } else {
    // 等径类,按尺寸/边缘/亮度细分
    if (d <= 18 && edge < 0.12 && circ >= 0.55) {
      type = 'starch'; // 小、光滑、近圆
    } else if (luma < 0.58 && pit >= 0.35 && wlr >= 1.2) {
      type = 'stone_cell'; // 暗、密纹孔、厚壁
    } else if (d >= 24 && verts >= 9 && luma >= 0.62) {
      type = 'calcium_cluster'; // 大、多顶点、亮结晶(边缘容忍度放宽)
    } else if (edge >= 0.2 && d >= 10 && d <= 48 && luma < 0.68) {
      type = 'pollen'; // 高边缘雕纹、中等尺寸、非高亮
    } else if (d >= 24 && verts >= 9) {
      type = 'calcium_cluster'; // 尺寸+顶点足够,亮度次之时仍优先簇晶
    } else {
      // 回退:取模糊分最高者
      type = topScore(s).type;
    }
  }

  // 门控:被规则选中的类别若模糊分过低,标记为不可信(识别不出就明说)
  let unknown = false;
  if (s[type] < UNKNOWN_THRESHOLD) {
    unknown = true;
  }

  const sorted = (Object.entries(s) as [StructureType, number][])
    .filter(([, v]) => v > 0.05)
    .sort((a, b) => b[1] - a[1]);
  const scores: Partial<Record<StructureType, number>> = {};
  for (const [k, v] of sorted) scores[k] = Math.round(v * 1000) / 1000;

  const bestScore = unknown ? topScore(s).score : s[type];
  const second = sorted.length > 1 ? sorted[1][1] : 0;
  const confidence = unknown
    ? bestScore
    : Math.min(0.99, bestScore * (0.7 + 0.3 * (bestScore - second) / Math.max(0.05, bestScore)));

  return { type: unknown ? 'unknown' : type, confidence, scores };
}

function topScore(s: Vec): { type: StructureType; score: number } {
  let type: StructureType = 'starch';
  let score = -1;
  for (const k of Object.keys(s) as StructureType[]) {
    if (s[k] > score) {
      score = s[k];
      type = k;
    }
  }
  return { type, score };
}
