import { clamp, fuzzyMembership, softmaxScores } from './mathUtils';
import type { DetectedObject, StructureType, VesselPattern } from './types';
import { ALL_STRUCTURE_TYPES } from './types';

/**
 * 单目标规则分类。
 * 策略：用可解释的连续性状给每类打原始分，softmax 归一；
 * 强诊断性状（圆度、长宽比、棱角、内腔）设硬门控，避免单类通吃。
 */
export function classifyObject(obj: DetectedObject): DetectedObject {
  const f = obj.features;
  const d = obj.diameterUm;
  const raw: Partial<Record<StructureType, number>> = {};

  const roundish = f.circularity > 0.78;
  const elongated = f.aspectRatio > 3;
  const veryElongated = f.aspectRatio > 5;

  // 气泡：必须近圆等轴（ar<1.6）+ 内部空（内部纹理/边缘极低）+ 内部亮、无棱角
  const isBubbleShape = f.circularity > 0.82 && f.aspectRatio < 1.6;
  const hollow = clamp(1 - f.interiorEnergy * 8, 0, 1.5) + clamp(1 - f.textureEnergy * 20, 0, 1.3);
  raw.bubble = isBubbleShape
    ? 1.8 + hollow + (f.meanDensity < 0.32 ? 0.8 : 0) - (f.tipCount > 4 ? 1.2 : 0) - (f.hilum ? 0.8 : 0)
    : -2.5;

  // 簇晶：棱角多（≥7）、低圆度、高凸度、内部折光纹理；与石细胞的区别在棱角锐且无内腔
  const angular = f.tipCount >= 7 ? 1.4 : f.tipCount * 0.12;
  raw.cluster_crystal =
    angular +
    clamp((1 - f.circularity) * 1.4, 0, 1.4) +
    clamp(f.convexity, 0, 1) * 0.7 +
    clamp(f.textureEnergy * 16, 0, 1.2) -
    (f.wallRatio > 0.55 ? 1.1 : 0) -
    (f.tipCount > 0 && f.tipCount < 7 ? 0.6 : 0) -
    (elongated ? 1 : 0) +
    fuzzyMembership(d, 8, 120, 18) * 0.6;

  // 方晶：硬门控——小尺寸(≤32μm)+少棱角(3~6)+近等轴(ar<2)+实心，任一不满足则强力排除
  const prismShape = d <= 32 && f.tipCount >= 3 && f.tipCount <= 6 && f.aspectRatio < 2 && f.wallRatio < 0.35;
  raw.prism_crystal = prismShape
    ? 1.6 +
      fuzzyMembership(f.aspectRatio, 0.7, 1.6, 0.4) +
      f.solidity * 0.8 +
      fuzzyMembership(d, 5, 28, 5)
    : -1.5;

  // 石细胞：近等轴/多角/分枝（ar<3.5）+ 显著壁厚内腔 + 纹孔；放射多棱角归簇晶
  const wallEvidence = clamp(f.wallRatio * 1.8, 0, 1.6);
  const pitEvidence = clamp(f.pitDensity / 7, 0, 1.2);
  raw.stone_cell =
    wallEvidence +
    pitEvidence * 0.9 +
    fuzzyMembership(d, 14, 100, 16) * 0.7 +
    (f.tipCount >= 3 && f.tipCount <= 9 ? 0.3 : -0.3) -
    (f.tipCount >= 10 ? 1.1 : 0) -
    (f.aspectRatio > 3.5 ? 1.6 : 0) -
    (f.wallRatio < 0.35 ? 1.2 : 0);

  // 导管：长条（ar>2.5）+ 粗直径 + 纹理方向性；近圆/等轴目标强惩罚
  const bestPattern = Math.max(...Object.values(f.patternScore));
  const vesselShape = f.aspectRatio > 2.5 && f.circularity < 0.7;
  raw.vessel = vesselShape
    ? 1.6 +
      (d > 26 ? 0.9 : 0.2) +
      clamp(bestPattern, 0, 1.5) +
      clamp(f.textureEnergy * 12, 0, 1) +
      fuzzyMembership(obj.lengthUm, 35, 320, 30) * 0.6 -
      (d < 24 && f.aspectRatio > 5 ? 0.9 : 0)
    : -1.5;

  // 纤维：极细长、细直径（≤30μm）、实心窄腔、无导管纹理
  const thinForFiber = d <= 30;
  raw.fiber =
    (veryElongated ? 2.2 : elongated ? 1.1 : 0.1) +
    (thinForFiber ? 0.9 : -0.7) +
    (f.circularity < 0.5 ? 0.6 : 0.1) +
    fuzzyMembership(d, 6, 28, 6) * 0.6 -
    (d > 26 ? 0.8 : 0) -
    (f.pitDensity > 10 ? 0.4 : 0) -
    (roundish ? 1 : 0);

  // 晶纤维：细长纤维 + 沿线高纹理（附着方晶 → 纹理能量显著高于普通纤维）
  raw.crystal_fiber =
    (veryElongated ? 1.8 : 0.2) +
    (thinForFiber ? 0.6 : -0.5) +
    clamp(f.textureEnergy * 22, 0, 1.5) +
    fuzzyMembership(d, 8, 28, 6) * 0.5 -
    (roundish ? 1 : 0) -
    (d > 26 ? 0.6 : 0);

  // 淀粉粒：小、近圆、实心、有脐点、内部均一
  raw.starch =
    (roundish ? 1.4 : f.circularity * 0.6) +
    fuzzyMembership(d, 2, 22, 6) * 1.3 +
    (f.hilum ? 1 : 0.2) +
    (f.cleft ? 0.5 : 0) +
    (f.wallRatio < 0.4 ? 0.5 : -0.6) +
    clamp(1 - f.textureEnergy * 12, 0, 0.7) -
    (f.tipCount > 5 ? 0.8 : 0) -
    (d > 26 ? 1 : 0);

  // 花粉粒：大而圆 + 刺状雕纹
  raw.pollen =
    (f.spiny ? 2.4 : 0) +
    (roundish ? 0.8 : 0.1) +
    fuzzyMembership(d, 25, 90, 14) +
    clamp(f.tipCount / 12, 0, 1) * 0.6;

  raw.debris = 0.3;

  const scores = softmaxScores(raw as Record<string, number>) as Partial<
    Record<StructureType, number>
  >;
  let best: StructureType = 'debris';
  let bestScore = -1;
  for (const t of ALL_STRUCTURE_TYPES) {
    const s = scores[t] ?? 0;
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }

  // 门控：原始分最高项若绝对强度不足（无强诊断特征），归为碎片而非硬套某类
  const scoredTypes = ALL_STRUCTURE_TYPES.filter((t) => t !== 'debris');
  const rawVals = scoredTypes.map((t) => raw[t] ?? -99);
  const sortedRaw = [...rawVals].sort((a, b) => b - a);
  const topRaw = sortedRaw[0];
  const margin = sortedRaw[0] - sortedRaw[1];
  // 门控：最高项需有一定绝对强度且领先次选，极弱特征才归碎片
  const strongEnough = topRaw >= 1.8 && margin >= 0.25;
  if (!strongEnough) {
    best = 'debris';
    bestScore = clamp(bestScore * 0.5, 0, 1);
  }

  let subtype: VesselPattern | undefined;
  if (best === 'vessel') {
    let bp: VesselPattern = 'reticulate';
    let bv = -1;
    for (const [k, v] of Object.entries(f.patternScore)) {
      if (v > bv) {
        bv = v;
        bp = k as VesselPattern;
      }
    }
    subtype = bp;
  }

  return {
    ...obj,
    type: best,
    confidence: clamp(bestScore, 0, 1),
    typeScores: scores,
    subtype,
  };
}

export function classifyAll(objects: DetectedObject[]): DetectedObject[] {
  return objects.map(classifyObject);
}

/** 重新计算计数（隐藏目标不计） */
export function recount(objects: DetectedObject[]): Record<StructureType, number> {
  const counts = Object.fromEntries(ALL_STRUCTURE_TYPES.map((t) => [t, 0])) as Record<
    StructureType,
    number
  >;
  for (const o of objects) {
    if (!o.hidden) counts[o.type]++;
  }
  return counts;
}
