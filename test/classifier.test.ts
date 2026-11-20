import { describe, it, expect } from 'vitest';
import { convexHull, hullSharpness, moments, polygonArea } from '../src/cv/geometry';
import { classifyRegion } from '../src/cv/classifier';
import type { RegionFeatures, StructureType } from '../src/types';

function baseRegion(over: Partial<RegionFeatures> = {}): RegionFeatures {
  return {
    id: 1,
    type: 'unknown',
    confidence: 0,
    classScores: {},
    cx: 100,
    cy: 100,
    area: 1000,
    perimeter: 120,
    bbox: { x: 80, y: 80, w: 40, h: 40 },
    equivDiameter: 35,
    circularity: 0.6,
    aspectRatio: 1.2,
    solidity: 0.85,
    darkRatio: 0.2,
    meanNormLuma: 0.5,
    edgeDensity: 0.1,
    orientation: 0,
    convexVertices: 12,
    crystalSharpness: 0.7,
    pitDensity: 0.4,
    vesselKind: 'reticulate',
    wallLumenRatio: 2,
    solidElongated: false,
    ...over,
  };
}

describe('geometry', () => {
  it('凸包正确包含正方形四角', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
      { x: 5, y: 5 },
    ];
    const hull = convexHull(pts);
    expect(hull.length).toBe(4);
    expect(polygonArea(hull)).toBeCloseTo(100, 5);
  });

  it('锐度:尖星形轮廓链高于钝多边形(凸包会削掉尖刺,故用轮廓链)', () => {
    const star: { x: number; y: number }[] = [];
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2;
      // 内外半径比 4:1,模拟簇晶尖锐棱角
      const rr = i % 2 === 0 ? 30 : 7;
      star.push({ x: 50 + Math.cos(ang) * rr, y: 50 + Math.sin(ang) * rr });
    }
    const blunt = Array.from({ length: 8 }, (_, i) => {
      const ang = (i / 8) * Math.PI * 2;
      return { x: 50 + Math.cos(ang) * 26, y: 50 + Math.sin(ang) * 26 };
    });
    // 凸包只保留外顶点;棱角锐度必须在完整轮廓链上计算
    const starSharp = hullSharpness(star).sharpness;
    const bluntSharp = hullSharpness(blunt).sharpness;
    expect(starSharp).toBeGreaterThan(bluntSharp);
    expect(starSharp).toBeGreaterThan(0.7);
    expect(bluntSharp).toBeLessThan(0.4);
  });

  it('矩计算长轴方向', () => {
    const pixels = new Int32Array();
    const arr: number[] = [];
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 6; y++) arr.push(y * 100 + x);
    }
    const m = moments(Int32Array.from(arr), 100);
    expect(m).not.toBeNull();
    expect(m!.major).toBeGreaterThan(m!.minor * 3);
    void pixels;
  });
});

describe('classifier 类别可分性', () => {
  const cases: { name: string; over: Partial<RegionFeatures>; expect: StructureType }[] = [
    { name: '簇晶-等径多尖棱', over: { aspectRatio: 1.15, crystalSharpness: 0.85, convexVertices: 16, solidity: 0.8, circularity: 0.45, wallLumenRatio: 4, meanNormLuma: 0.72, solidElongated: true }, expect: 'calcium_cluster' },
    { name: '针晶-极细长', over: { aspectRatio: 9, circularity: 0.12, solidity: 0.6, edgeDensity: 0.2, solidElongated: true, meanNormLuma: 0.72 }, expect: 'calcium_needle' },
    { name: '石细胞-厚壁有纹孔', over: { aspectRatio: 1.4, wallLumenRatio: 3.2, darkRatio: 0.35, pitDensity: 0.7, solidity: 0.85, meanNormLuma: 0.42, crystalSharpness: 0.35 }, expect: 'stone_cell' },
    { name: '导管-长管有腔纹式', over: { aspectRatio: 5, edgeDensity: 0.35, wallLumenRatio: 1.1, darkRatio: 0.3, equivDiameter: 30, solidElongated: false }, expect: 'vessel' },
    { name: '纤维-极细长厚壁', over: { aspectRatio: 10, wallLumenRatio: 4, edgeDensity: 0.1, solidity: 0.7, circularity: 0.2, solidElongated: true, meanNormLuma: 0.45 }, expect: 'fiber' },
    { name: '淀粉-小圆光滑', over: { aspectRatio: 1.1, circularity: 0.85, equivDiameter: 9, edgeDensity: 0.05, solidity: 0.95 }, expect: 'starch' },
    { name: '花粉-中圆有雕纹', over: { aspectRatio: 1.1, circularity: 0.8, equivDiameter: 24, edgeDensity: 0.3, pitDensity: 0.1, meanNormLuma: 0.6, wallLumenRatio: 0.8 }, expect: 'pollen' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = classifyRegion(baseRegion(c.over));
      expect(r.type).toBe(c.expect);
    });
  }

  it('过渡区特征的置信度显著低于典型结构', () => {
    const ambiguous = classifyRegion(baseRegion({
      // 边界过渡区:边缘密度/尺寸/亮度均不贴合任一类
      aspectRatio: 1.9, circularity: 0.42, solidity: 0.5, edgeDensity: 0.13,
      darkRatio: 0.2, crystalSharpness: 0.18, convexVertices: 6, pitDensity: 0.2,
      wallLumenRatio: 1.0, equivDiameter: 23, meanNormLuma: 0.61, solidElongated: true,
    }));
    const typical = classifyRegion(baseRegion({
      aspectRatio: 1.1, circularity: 0.85, equivDiameter: 9, edgeDensity: 0.05, solidity: 0.95,
    }));
    // 模糊样本要么判 unknown,要么置信度明显低于典型淀粉粒
    if (ambiguous.type !== 'unknown') {
      expect(ambiguous.confidence).toBeLessThan(typical.confidence);
    }
  });

  it('所有类别得分在 0..1', () => {
    const r = classifyRegion(baseRegion());
    for (const v of Object.values(r.scores)) {
      expect(v!).toBeGreaterThanOrEqual(0);
      expect(v!).toBeLessThanOrEqual(1);
    }
  });
});
