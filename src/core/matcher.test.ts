import { describe, expect, it } from 'vitest';
import { detectMixture, matchDrugs } from './matcher';
import type { DetectedObject, MeasuredFeatures, StructureType } from './types';

function obj(type: StructureType, over: Partial<MeasuredFeatures> = {}, id = 1): DetectedObject {
  return {
    id,
    type,
    confidence: 0.9,
    typeScores: {},
    bbox: { x: 0, y: 0, w: 30, h: 30 },
    centroid: { x: 15, y: 15 },
    polygon: [],
    features: {
      areaPx: 300,
      perimeterPx: 60,
      equivDiameterPx: 20,
      majorAxisPx: 22,
      minorAxisPx: 18,
      aspectRatio: 1.2,
      circularity: 0.7,
      solidity: 0.85,
      convexity: 0.9,
      eccentricity: 0.4,
      extent: 0.7,
      radialSymmetry: 0.8,
      wallRatio: 0.4,
      lumenRatio: 0.4,
      tipAngles: over.tipAngles ?? [40],
      tipCount: over.tipCount ?? 6,
      tipSharpness: 0.5,
      pitDensity: over.pitDensity ?? 8,
      ridgeDensity: over.ridgeDensity ?? 10,
      patternScore: { reticulate: 1, pitted: 0.4, bordered_pitted: 0.4, spiral: 0.2, annular: 0.2 },
      hilum: false,
      cleft: false,
      spiny: false,
      meanDensity: 0.4,
      textureEnergy: 0.08,
      interiorEnergy: 0.12,
      rimEnergy: 0.25,
      ...over,
    },
    diameterUm: 40,
    lengthUm: 60,
    overlapped: false,
    edited: false,
    hidden: false,
  };
}

describe('药典匹配', () => {
  it('大黄档案（大簇晶+大导管+淀粉）应排在前列', () => {
    const objects = [
      ...Array.from({ length: 12 }, (_, i) =>
        obj('cluster_crystal', { tipAngles: [60], tipCount: 12 }, i + 1),
      ),
      ...Array.from({ length: 5 }, (_, i) => obj('vessel', { aspectRatio: 4 }, 20 + i)),
      ...Array.from({ length: 10 }, (_, i) => obj('starch', { circularity: 0.95 }, 40 + i)),
    ];
    const matches = matchDrugs(objects);
    expect(matches[0].drugId).toBe('dahuang');
    expect(matches[0].score).toBeGreaterThan(0.4);
    expect(matches[0].evidence.length).toBeGreaterThan(2);
  });

  it('锐尖小簇晶组合应倾向人参而非大黄', () => {
    const objects = [
      ...Array.from({ length: 8 }, (_, i) =>
        obj('cluster_crystal', { tipAngles: [22], tipCount: 8 }, i + 1),
      ),
      ...Array.from({ length: 4 }, (_, i) => obj('vessel', {}, 20 + i)),
      ...Array.from({ length: 8 }, (_, i) => obj('starch', {}, 40 + i)),
    ];
    const matches = matchDrugs(objects);
    const renshen = matches.find((m) => m.drugId === 'renshen')!;
    const dahuang = matches.find((m) => m.drugId === 'dahuang')!;
    expect(renshen.score).toBeGreaterThan(dahuang.score);
  });

  it('棱角双峰的簇晶群触发掺伪检测', () => {
    const objects = [
      ...Array.from({ length: 5 }, (_, i) => obj('cluster_crystal', { tipAngles: [20], tipCount: 7 }, i + 1)),
      ...Array.from({ length: 5 }, (_, i) => obj('cluster_crystal', { tipAngles: [70], tipCount: 12 }, 10 + i)),
      ...Array.from({ length: 4 }, (_, i) => obj('vessel', {}, 30 + i)),
    ];
    const matches = matchDrugs(objects);
    const mix = detectMixture(objects, matches);
    expect(mix.detected).toBe(true);
    expect(mix.components.length).toBeGreaterThanOrEqual(2);
  });

  it('均一形态的单味样品不误报掺伪', () => {
    const objects = Array.from({ length: 8 }, (_, i) =>
      obj('cluster_crystal', { tipAngles: [55], tipCount: 11 }, i + 1),
    );
    const matches = matchDrugs(objects);
    const mix = detectMixture(objects, matches);
    expect(mix.detected).toBe(false);
  });
});
