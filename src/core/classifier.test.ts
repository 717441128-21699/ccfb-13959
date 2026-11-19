import { describe, expect, it } from 'vitest';
import { classifyObject } from './classifier';
import type { DetectedObject, MeasuredFeatures } from './types';

function baseFeatures(over: Partial<MeasuredFeatures> = {}): MeasuredFeatures {
  return {
    areaPx: 400,
    perimeterPx: 72,
    equivDiameterPx: 22,
    majorAxisPx: 24,
    minorAxisPx: 20,
    aspectRatio: 1.2,
    circularity: 0.8,
    solidity: 0.9,
    convexity: 0.9,
    eccentricity: 0.4,
    extent: 0.75,
    radialSymmetry: 0.85,
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
    ...over,
  };
}

function makeObj(over: Partial<MeasuredFeatures> = {}, diamUm = 30, lengthUm = 30): DetectedObject {
  return {
    id: 1,
    type: 'debris',
    confidence: 0,
    typeScores: {},
    bbox: { x: 0, y: 0, w: 40, h: 40 },
    centroid: { x: 20, y: 20 },
    polygon: [],
    features: baseFeatures(over),
    diameterUm: diamUm,
    lengthUm,
    overlapped: false,
    edited: false,
    hidden: false,
  };
}

describe('规则分类器', () => {
  it('多棱角强纹理目标判为簇晶', () => {
    const r = classifyObject(
      makeObj({ tipCount: 11, tipAngles: [30, 28, 35], circularity: 0.45, textureEnergy: 0.12, convexity: 0.95 }, 55),
    );
    expect(r.type).toBe('cluster_crystal');
  });

  it('高圆度亮空泡带强边缘判为气泡而非淀粉', () => {
    const r = classifyObject(
      makeObj({ circularity: 0.96, textureEnergy: 0.01, interiorEnergy: 0.01, rimEnergy: 0.7, meanDensity: 0.18, tipCount: 1 }, 24),
    );
    expect(r.type).toBe('bubble');
  });

  it('壁厚多纹孔目标判为石细胞', () => {
    const r = classifyObject(
      makeObj({ wallRatio: 0.62, pitDensity: 14, tipCount: 5, solidity: 0.68, interiorEnergy: 0.25 }, 50),
    );
    expect(r.type).toBe('stone_cell');
  });

  it('细长强纹理目标判为导管并给出亚型', () => {
    const r = classifyObject(
      makeObj(
        {
          aspectRatio: 5.2,
          circularity: 0.25,
          textureEnergy: 0.12,
          patternScore: { reticulate: 1.4, pitted: 0.5, bordered_pitted: 0.6, spiral: 0.3, annular: 0.2 },
        },
        40,
        180,
      ),
    );
    expect(r.type).toBe('vessel');
    expect(r.subtype).toBe('reticulate');
  });

  it('小圆形带脐点目标判为淀粉粒', () => {
    const r = classifyObject(
      makeObj({ circularity: 0.92, hilum: true, cleft: true, textureEnergy: 0.02, tipCount: 0 }, 8),
    );
    expect(r.type).toBe('starch');
  });

  it('所有类别置信度归一到 0..1', () => {
    const r = classifyObject(makeObj());
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    const sum = Object.values(r.typeScores).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});
