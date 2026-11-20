import { describe, it, expect } from 'vitest';
import { aggregateAnalyses, identifySample, matchHerb } from '../src/cv/matcher';
import { HERB_PROFILES } from '../src/data/herbs';
import type { ImageAnalysis, RegionFeatures, StructureType } from '../src/types';

function region(type: StructureType, i: number, over: Partial<RegionFeatures> = {}): RegionFeatures {
  return {
    id: i, type, confidence: 0.8, classScores: {},
    cx: 10 + i, cy: 10 + i, area: 500, perimeter: 80,
    bbox: { x: 0, y: 0, w: 30, h: 30 },
    equivDiameter: 30, circularity: 0.6, aspectRatio: 1.3, solidity: 0.85,
    darkRatio: 0.2, meanNormLuma: 0.5, edgeDensity: 0.15, orientation: 0, convexVertices: 12,
    crystalSharpness: 0.7, pitDensity: 0.5, vesselKind: 'reticulate', wallLumenRatio: 2,
    solidElongated: false,
    ...over,
  };
}

function analysis(types: StructureType[]): ImageAnalysis {
  const regions = types.map((t, i) => region(t, i,
    t === 'calcium_cluster'
      ? { equivDiameter: 70, crystalSharpness: 0.35, meanNormLuma: 0.72, solidElongated: true }
      : t === 'stone_cell'
        ? { equivDiameter: 45, pitDensity: 0.4, meanNormLuma: 0.4 }
        : {}));
  const counts: Record<StructureType, number> = {
    calcium_cluster: 0, calcium_needle: 0, stone_cell: 0,
    vessel: 0, fiber: 0, starch: 0, pollen: 0,
  };
  for (const t of types) counts[t]++;
  return {
    imageId: 'x', width: 100, height: 100,
    regions, annotations: [], counts,
    sizeStats: {}, timings: {},
  };
}

describe('matcher', () => {
  it('大黄:大量簇晶应排第一', () => {
    const verdict = identifySample(
      [analysis(['calcium_cluster', 'calcium_cluster', 'calcium_cluster', 'starch', 'vessel'])],
      HERB_PROFILES,
    );
    expect(verdict.matches[0].herbId).toBe('dahuang');
    expect(verdict.matches[0].evidence.length).toBeGreaterThan(0);
  });

  it('半夏:针晶+淀粉应排第一', () => {
    const verdict = identifySample(
      [analysis(['calcium_needle', 'calcium_needle', 'starch', 'starch', 'vessel'])],
      HERB_PROFILES,
    );
    expect(verdict.matches[0].herbId).toBe('banxia');
  });

  it('蒲黄:花粉粒应排第一', () => {
    const verdict = identifySample(
      [analysis(['pollen', 'pollen', 'pollen'])],
      HERB_PROFILES,
    );
    expect(verdict.matches[0].herbId).toBe('puhuang');
  });

  it('掺伪:大黄主成分(簇晶占优)+ 大量石细胞(黄柏/黄连线索)应触发提示', () => {
    const verdict = identifySample(
      [analysis([
        'calcium_cluster', 'calcium_cluster', 'calcium_cluster',
        'calcium_cluster', 'calcium_cluster', 'calcium_cluster',
        'calcium_cluster',
        'stone_cell', 'stone_cell', 'stone_cell', 'stone_cell',
      ])],
      HERB_PROFILES,
    );
    expect(verdict.matches[0].herbId).toBe('dahuang');
    expect(verdict.adulteration.supportingTypes).toContain('stone_cell');
    expect(verdict.adulteration.reason.length).toBeGreaterThan(0);
  });

  it('单味药打分在 0..1 且含依据文本', () => {
    const agg = aggregateAnalyses([analysis(['calcium_cluster', 'fiber'])]);
    const m = matchHerb(HERB_PROFILES[0], agg);
    expect(m.score).toBeGreaterThanOrEqual(0);
    expect(m.score).toBeLessThanOrEqual(1);
    expect(Array.isArray(m.evidence)).toBe(true);
  });
});
