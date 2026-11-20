/**
 * 药典特征比对引擎。
 * 输入:一个样品多张图聚合后的结构统计;输出:最像的药材排名 + 逐条依据 + 掺伪判断。
 * 评分完全显式可解释,不做黑盒相似度。
 */
import type {
  HerbProfile,
  HerbMatch,
  ImageAnalysis,
  RegionFeatures,
  SampleVerdict,
  StructureType,
} from '../types';

const ALL_TYPES: StructureType[] = [
  'calcium_cluster', 'calcium_needle', 'stone_cell',
  'vessel', 'fiber', 'starch', 'pollen',
];

export interface SizeStat {
  mean: number;
  min: number;
  max: number;
  n: number;
}

export interface AggregateStats {
  counts: Record<StructureType, number>;
  sizeStats: Partial<Record<StructureType, SizeStat>>;
  regions: RegionFeatures[];
}

export function aggregateAnalyses(analyses: ImageAnalysis[]): AggregateStats {
  const counts: Record<StructureType, number> = {
    calcium_cluster: 0, calcium_needle: 0, stone_cell: 0,
    vessel: 0, fiber: 0, starch: 0, pollen: 0,
  };
  const byType = new Map<StructureType, RegionFeatures[]>();
  const regions: RegionFeatures[] = [];
  for (const a of analyses) {
    for (const t of ALL_TYPES) counts[t] += a.counts[t];
    for (const r of a.regions) {
      regions.push(r);
      if (r.type !== 'unknown') {
        const arr = byType.get(r.type) ?? [];
        arr.push(r);
        byType.set(r.type, arr);
      }
    }
  }
  const sizeStats: AggregateStats['sizeStats'] = {};
  for (const [t, arr] of byType) {
    const ds = arr.map((r) => r.equivDiameter);
    sizeStats[t] = {
      mean: ds.reduce((x, y) => x + y, 0) / ds.length,
      min: Math.min(...ds),
      max: Math.max(...ds),
      n: ds.length,
    };
  }
  return { counts, sizeStats, regions };
}

function inRange(x: number, range: [number, number] | undefined): boolean | null {
  if (!range) return null;
  return x >= range[0] && x <= range[1];
}

/** 单味药打分。 */
export function matchHerb(herb: HerbProfile, agg: AggregateStats): HerbMatch {
  const evidence: string[] = [];
  const missingHallmarks: string[] = [];
  let score = 0;
  let maxScore = 0;
  let missingHallmarkPenalty = 0;

  for (const f of herb.features) {
    // 标志特征权重 3:药典中标志特征是定性鉴别主依据,缺失重罚、出现重奖
    const weight = f.hallmark ? 3 : 1;
    maxScore += weight;
    const n = agg.counts[f.type];
    if (n === 0) {
      if (f.hallmark) {
        missingHallmarks.push(f.description);
        // 标志特征缺失按满分 40% 罚分,而不是简单跳过(防止靠多记载特征刷分)
        missingHallmarkPenalty += weight * 0.4;
      }
      continue;
    }
    // 出现即给基础分;标志性特征出现得越多基础分越高(趋近 0.85)
    let fit = Math.min(0.85, 0.55 + 0.12 * Math.min(3, n));
    const detail: string[] = [];

    const size = agg.sizeStats[f.type];
    if (size && f.diameterRange) {
      const vals = agg.regions
        .filter((r) => r.type === f.type)
        .map((r) => r.equivDiameter);
      const hit = vals.filter((d) => d >= f.diameterRange![0] && d <= f.diameterRange![1]).length /
        Math.max(1, vals.length);
      // 尺寸范围是强约束:完全命中给满分,完全不匹配压到 0.25
      fit = 0.25 + 0.6 * hit;
      detail.push(`尺寸均值${Math.round(size.mean)}px(参考${f.diameterRange[0]}~${f.diameterRange[1]},命中率${(hit * 100).toFixed(0)}%)`);
    }

    if (f.sharpnessRange) {
      const vals = agg.regions
        .filter((r) => r.type === f.type && r.crystalSharpness !== undefined)
        .map((r) => r.crystalSharpness!);
      if (vals.length) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const hit = inRange(mean, f.sharpnessRange);
        fit = Math.min(1, fit + (hit ? 0.15 : -0.1));
        detail.push(`棱角锐度${mean.toFixed(2)}(参考${f.sharpnessRange[0]}~${f.sharpnessRange[1]})`);
      }
    }

    if (f.pitDensityRange) {
      const vals = agg.regions
        .filter((r) => r.type === f.type && r.pitDensity !== undefined)
        .map((r) => r.pitDensity!);
      if (vals.length) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const hit = inRange(mean, f.pitDensityRange);
        fit = Math.min(1, fit + (hit ? 0.15 : -0.1));
        detail.push(`纹孔密度${mean.toFixed(2)}(参考${f.pitDensityRange[0]}~${f.pitDensityRange[1]})`);
      }
    }

    if (f.vesselKinds) {
      const kinds = agg.regions
        .filter((r) => r.type === 'vessel' && r.vesselKind)
        .map((r) => r.vesselKind!);
      if (kinds.length) {
        const hit = kinds.filter((k) => f.vesselKinds!.includes(k)).length / kinds.length;
        fit = Math.min(1, fit + 0.1 * hit);
        detail.push(`导管纹式命中${Math.round(hit * 100)}%`);
      }
    }

    if (f.wallLumenRatioRange) {
      const vals = agg.regions
        .filter((r) => (r.type === f.type) && r.wallLumenRatio !== undefined)
        .map((r) => r.wallLumenRatio!);
      if (vals.length) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const hit = inRange(mean, f.wallLumenRatioRange);
        fit = Math.min(1, fit + (hit ? 0.12 : -0.08));
        detail.push(`壁腔比${mean.toFixed(2)}`);
      }
    }

    score += weight * Math.max(0, fit);
    evidence.push(
      `${f.hallmark ? '【标志】' : ''}检出 ${n} 个${typeName(f.type)}:${f.description}` +
      (detail.length ? `;${detail.join(';')}` : ''),
    );
  }

  // 惩罚:样品里有该药完全不记载的结构类型(可能是杂质或掺伪线索,不重罚)
  let extra = 0;
  const known = new Set(herb.features.map((f) => f.type));
  for (const t of ALL_TYPES) {
    if (!known.has(t) && agg.counts[t] >= 3) extra += 0.03;
  }

  const normalized = Math.max(0, (score - missingHallmarkPenalty) / maxScore - extra);
  return {
    herbId: herb.id,
    herbName: herb.name,
    score: Math.round(normalized * 1000) / 1000,
    evidence,
    missingHallmarks,
  };
}

function typeName(t: StructureType): string {
  const map: Record<StructureType, string> = {
    calcium_cluster: '草酸钙簇晶',
    calcium_needle: '草酸钙针晶',
    stone_cell: '石细胞',
    vessel: '导管',
    fiber: '纤维',
    starch: '淀粉粒',
    pollen: '花粉粒',
  };
  return map[t];
}

/**
 * 掺伪检测:排名第一的药材无法解释的结构群(某类 ≥3 个且该药不记载),
 * 用这些剩余结构对其余药材再做一次匹配,若某味药解释得好 → 判疑似掺伪。
 */
function detectAdulteration(
  matches: HerbMatch[],
  profiles: HerbProfile[],
  agg: AggregateStats,
): SampleVerdict['adulteration'] {
  const primary = matches[0];
  if (!primary) {
    return { detected: false, supportingTypes: [], reason: '无有效匹配结果' };
  }
  const primaryHerb = profiles.find((h) => h.id === primary.herbId);
  if (!primaryHerb) return { detected: false, supportingTypes: [], reason: '' };
  const known = new Set(primaryHerb.features.map((f) => f.type));
  const unexplained = ALL_TYPES.filter((t) => !known.has(t) && agg.counts[t] >= 3);
  if (unexplained.length === 0) {
    return { detected: false, supportingTypes: [], reason: '所有检出结构均可由主成分解释' };
  }

  // 用剩余结构构建子统计,寻找第二来源药材
  const subCounts: Record<StructureType, number> = {
    calcium_cluster: 0, calcium_needle: 0, stone_cell: 0,
    vessel: 0, fiber: 0, starch: 0, pollen: 0,
  };
  for (const t of unexplained) subCounts[t] = agg.counts[t];
  const subAgg: AggregateStats = {
    counts: subCounts,
    sizeStats: Object.fromEntries(
      unexplained.map((t) => [t, agg.sizeStats[t]]).filter(([, v]) => v),
    ) as AggregateStats['sizeStats'],
    regions: agg.regions.filter((r) => r.type !== 'unknown' && unexplained.includes(r.type)),
  };

  let second: HerbMatch | null = null;
  for (const herb of profiles) {
    if (herb.id === primary.herbId) continue;
    const m = matchHerb(herb, subAgg);
    if (!second || m.score > second.score) second = m;
  }
  const detected = !!second && second.score >= 0.45;
  return {
    detected,
    secondaryHerbId: detected ? second!.herbId : undefined,
    secondaryHerbName: detected ? second!.herbName : undefined,
    supportingTypes: unexplained,
    reason: detected
      ? `主成分 ${primary.herbName} 不能解释 ${unexplained.map(typeName).join('、')};该结构群与 ${second!.herbName} 的特征吻合度 ${(second!.score * 100).toFixed(0)}%`
      : `存在主成分未记载结构:${unexplained.map(typeName).join('、')},但未找到稳定的第二来源,建议人工复核`,
  };
}

export function identifySample(
  analyses: ImageAnalysis[],
  profiles: HerbProfile[],
): SampleVerdict {
  const t0 = performance.now();
  const agg = aggregateAnalyses(analyses);
  const matches = profiles
    .map((h) => matchHerb(h, agg))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const adulteration = detectAdulteration(matches, profiles, agg);
  return {
    matches,
    adulteration,
    aggregateCounts: agg.counts,
    totalTimeMs: performance.now() - t0,
  };
}
