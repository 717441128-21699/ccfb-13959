import { DRUG_PROFILES } from './knowledgeBase';
import type { DrugProfile } from './types';
import { fuzzyMembership, isBimodal, kmeans1d, mean, weightedSum } from './mathUtils';
import type {
  DetectedObject,
  DrugMatch,
  EvidenceLine,
  ExpectedStructure,
  MixtureResult,
  StructureType,
  TraitName,
} from './types';

const DIAGNOSTIC_TYPES = new Set<StructureType>([
  'cluster_crystal',
  'prism_crystal',
  'stone_cell',
  'vessel',
  'fiber',
  'crystal_fiber',
  'pollen',
]);

function groupByType(objects: DetectedObject[]): Map<StructureType, DetectedObject[]> {
  const map = new Map<StructureType, DetectedObject[]>();
  for (const o of objects) {
    if (o.hidden || o.type === 'bubble' || o.type === 'debris') continue;
    let arr = map.get(o.type);
    if (!arr) {
      arr = [];
      map.set(o.type, arr);
    }
    arr.push(o);
  }
  return map;
}

function traitMean(objs: DetectedObject[], trait: TraitName): number | undefined {
  const vals: number[] = [];
  for (const o of objs) {
    const f = o.features;
    switch (trait) {
      case 'diameter':
        vals.push(o.diameterUm);
        break;
      case 'length':
        vals.push(o.lengthUm);
        break;
      case 'aspectRatio':
        vals.push(f.aspectRatio);
        break;
      case 'tipAngle':
        if (f.tipAngles.length) vals.push(mean(f.tipAngles));
        break;
      case 'tipCount':
        vals.push(f.tipCount);
        break;
      case 'wallRatio':
        vals.push(f.wallRatio);
        break;
      case 'pitDensity':
        vals.push(f.pitDensity);
        break;
      case 'ridgeDensity':
        vals.push(f.ridgeDensity);
        break;
      case 'solidity':
        vals.push(f.solidity);
        break;
      case 'circularity':
        vals.push(f.circularity);
        break;
    }
  }
  return vals.length ? mean(vals) : undefined;
}

function scoreExpected(
  exp: ExpectedStructure,
  observed: DetectedObject[] | undefined,
): { score: number; evidence: EvidenceLine[]; missing: EvidenceLine[] } {
  const weight = Math.log2(1 + exp.abundance);
  const evidence: EvidenceLine[] = [];
  const missing: EvidenceLine[] = [];
  const n = observed?.length ?? 0;
  if (n === 0) {
    missing.push({
      text: `未见${exp.text.split('，')[0]}`,
      hit: false,
      weight,
    });
    return { score: 0, evidence, missing };
  }
  const abundanceScore = Math.min(1, n / Math.max(2, exp.abundance * 0.55));
  evidence.push({
    text: `检出 ${n} 个目标，期望丰度级别 ${exp.abundance}`,
    hit: true,
    weight: weight * 0.4,
  });

  const traitTerms: { value: number; weight: number }[] = [];
  if (exp.traits && observed) {
    for (const [trait, range] of Object.entries(exp.traits) as [TraitName, { lo: number; hi: number; tol?: number }][]) {
      const mv = traitMean(observed, trait);
      if (mv === undefined) continue;
      const m = fuzzyMembership(mv, range.lo, range.hi, range.tol ?? 0);
      traitTerms.push({ value: m, weight: 1 });
      evidence.push({
        text: `${traitLabel(trait)}实测 ${mv.toFixed(1)}，药典区间 ${range.lo}~${range.hi}（符合度 ${(m * 100).toFixed(0)}%）`,
        hit: m >= 0.5,
        weight: 0.5,
      });
    }
  }
  // 导管亚型
  if (exp.subtype && observed) {
    const subtypeHit = observed.some((o) => o.subtype === exp.subtype);
    const subScore = subtypeHit ? 1 : 0.35;
    traitTerms.push({ value: subScore, weight: 1.4 });
    evidence.push({
      text: `导管纹理亚型：期望「${exp.subtype}」，${subtypeHit ? '已匹配' : '未精确匹配（按近似处理）'}`,
      hit: subtypeHit,
      weight: 0.7,
    });
  }
  const traitScore = traitTerms.length ? weightedSum(traitTerms) : 0.7;
  const score = 0.45 * abundanceScore + 0.55 * traitScore;
  return { score, evidence, missing };
}

function traitLabel(t: TraitName): string {
  const labels: Record<TraitName, string> = {
    diameter: '直径',
    length: '长度',
    aspectRatio: '长宽比',
    tipAngle: '棱角角度',
    tipCount: '棱角数',
    wallRatio: '壁厚占比',
    pitDensity: '纹孔密度',
    ridgeDensity: '脊线密度',
    solidity: '实体度',
    circularity: '圆度',
  };
  return labels[t];
}

export function matchDrugs(objects: DetectedObject[]): DrugMatch[] {
  const grouped = groupByType(objects);
  const matches: DrugMatch[] = [];
  for (const profile of DRUG_PROFILES) {
    const evidence: EvidenceLine[] = [];
    const missing: EvidenceLine[] = [];
    const terms: { value: number; weight: number }[] = [];
    const profileTypes = new Set<StructureType>();
    for (const exp of profile.structures) {
      profileTypes.add(exp.type);
      const r = scoreExpected(exp, grouped.get(exp.type));
      evidence.push(...r.evidence);
      missing.push(...r.missing);
      terms.push({ value: r.score, weight: Math.log2(1 + exp.abundance) });
    }
    // 多出来的诊断性结构 → 减分（掺伪线索保留在 evidence 中）
    let penalty = 0;
    for (const [type, arr] of grouped) {
      if (!DIAGNOSTIC_TYPES.has(type) || profileTypes.has(type)) continue;
      penalty += Math.min(0.12, arr.length * 0.05);
      evidence.push({
        text: `出现本品不应有的「${type}」×${arr.length}（掺伪/混淆线索）`,
        hit: false,
        weight: 0.8,
      });
    }
    const base = weightedSum(terms);
    const score = Math.max(0, base - penalty);
    matches.push({
      drugId: profile.id,
      drugName: profile.name,
      score,
      evidence: evidence.sort((a, b) => b.weight - a.weight).slice(0, 10),
      missing,
    });
  }
  return matches.sort((a, b) => b.score - a.score);
}

/** 掺伪检测：双峰性状 + 双档案证据联合判断 */
export function detectMixture(objects: DetectedObject[], matches: DrugMatch[]): MixtureResult {
  const grouped = groupByType(objects);
  const reasons: string[] = [];
  const components = new Set<string>();
  let support = 0;

  // 证据 1：Top1/Top2 得分接近
  if (matches.length >= 2 && matches[0].score - matches[1].score < 0.1 && matches[1].score > 0.5) {
    components.add(matches[0].drugId);
    components.add(matches[1].drugId);
    reasons.push(
      `整体相似度前两名「${matches[0].drugName} ${(matches[0].score * 100).toFixed(0)}%」「${matches[1].drugName} ${(matches[1].score * 100).toFixed(0)}%」接近，符合两味药混合特征`,
    );
    support += 2;
  }

  // 证据 2：簇晶棱角双峰（锐尖 vs 短钝）
  const clusters = grouped.get('cluster_crystal');
  if (clusters && clusters.length >= 5) {
    const angles = clusters.map((o) => mean(o.features.tipAngles));
    if (angles.filter((a) => a > 0).length >= 5 && isBimodal(angles)) {
      const km = kmeans1d(angles);
      const sharp = clusters.filter((_, i) => km.labels[i] === 0);
      const obtuse = clusters.filter((_, i) => km.labels[i] === 1);
      reasons.push(
        `簇晶棱角呈双峰分布：一组均角 ${km.centers[0].toFixed(0)}°（锐尖，${sharp.length} 个），另一组 ${km.centers[1].toFixed(0)}°（短钝，${obtuse.length} 个），分属不同药材`,
      );
      support += 3;
      components.add(pickDrugByTrait('cluster_crystal', 'tipAngle', km.centers[0]));
      components.add(pickDrugByTrait('cluster_crystal', 'tipAngle', km.centers[1]));
    }
  }

  // 证据 3：石细胞纹孔密度双峰（疏 vs 密）
  const stones = grouped.get('stone_cell');
  if (stones && stones.length >= 5) {
    const pits = stones.map((o) => o.features.pitDensity);
    if (isBimodal(pits)) {
      const km = kmeans1d(pits);
      reasons.push(
        `石细胞壁纹孔密度双峰：${km.centers[0].toFixed(1)} 与 ${km.centers[1].toFixed(1)} 个/100μm，对应两种石细胞来源`,
      );
      support += 3;
      components.add(pickDrugByTrait('stone_cell', 'pitDensity', km.centers[0]));
      components.add(pickDrugByTrait('stone_cell', 'pitDensity', km.centers[1]));
    }
  }

  // 证据 4：互斥诊断特征共存（晶纤维+分枝石细胞 等）
  const has = (t: StructureType) => grouped.has(t) && (grouped.get(t)?.length ?? 0) >= 2;
  const exclusivePairs: [StructureType, StructureType, string][] = [
    ['crystal_fiber', 'stone_cell', '晶纤维与分枝石细胞同时大量出现'],
    ['prism_crystal', 'cluster_crystal', '方晶与簇晶分别成组出现且形态差异显著'],
  ];
  for (const [a, b, text] of exclusivePairs) {
    if (has(a) && has(b)) {
      reasons.push(text);
      support += 2;
      components.add(matches[0]?.drugId ?? '');
      components.add(matches[1]?.drugId ?? '');
    }
  }

  const detected = support >= 3;
  const names = [...components].filter(Boolean).map((id) => DRUG_PROFILES.find((d) => d.id === id)?.name ?? id);
  return {
    detected,
    components: [...new Set(names)],
    confidence: detected ? Math.min(0.95, 0.55 + support * 0.1) : 0,
    reason: detected ? reasons.join('；') : reasons.length ? reasons.join('；') : '未发现掺伪的双峰或互斥特征证据',
  };
}

function pickDrugByTrait(type: StructureType, trait: TraitName, value: number): string {
  let bestId = '';
  let bestDist = Infinity;
  for (const p of DRUG_PROFILES) {
    for (const s of p.structures) {
      if (s.type !== type || !s.traits) continue;
      const range = s.traits[trait];
      if (!range) continue;
      const mid = (range.lo + range.hi) / 2;
      const d = Math.abs(mid - value);
      if (d < bestDist) {
        bestDist = d;
        bestId = p.id;
      }
    }
  }
  return bestId;
}

export function profileOf(id: string): DrugProfile | undefined {
  return DRUG_PROFILES.find((d) => d.id === id);
}
