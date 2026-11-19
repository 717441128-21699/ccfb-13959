import { describe, expect, it } from 'vitest';
import { fuzzyMembership, isBimodal, kmeans1d, Rng, softmaxScores } from './mathUtils';
import { convexHull, detectTips, momentsFromPixels, polygonArea } from './geometry';
import { UnionFind, connectedComponents, fillHoles, traceContour } from './cpuImaging';

describe('模糊隶属与统计', () => {
  it('区间内为 1，容忍带内线性衰减', () => {
    expect(fuzzyMembership(50, 40, 60, 10)).toBe(1);
    expect(fuzzyMembership(35, 40, 60, 10)).toBeCloseTo(0.5);
    expect(fuzzyMembership(29, 40, 60, 10)).toBe(0);
    expect(fuzzyMembership(70, 40, 60, 10)).toBe(0);
  });

  it('softmax 输出归一且最大项对应最大原始分', () => {
    const s = softmaxScores({ a: 2, b: 0.1, c: -1 });
    const sum = Object.values(s).reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(1);
    expect(s.a).toBeGreaterThan(s.b);
  });

  it('可复现随机数', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect(Array.from({ length: 8 }, () => a.next())).toEqual(Array.from({ length: 8 }, () => b.next()));
  });

  it('一维 k-means 能分开两簇并识别双峰', () => {
    const data = [10, 11, 9, 10, 40, 42, 39, 41];
    const km = kmeans1d(data);
    expect(km.separated).toBe(true);
    expect(km.centers[0]).toBeLessThan(15);
    expect(km.centers[1]).toBeGreaterThan(35);
    expect(isBimodal(data)).toBe(true);
    expect(isBimodal([10, 11, 10, 11])).toBe(false);
  });
});

describe('几何与图像矩', () => {
  it('凸包面积 >= 原多边形面积', () => {
    const star = [
      { x: 0, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 1 },
    ];
    const hull = convexHull(star);
    expect(polygonArea(hull)).toBeGreaterThanOrEqual(polygonArea(star));
  });

  it('圆斑的图像矩长短轴接近', () => {
    const px = [];
    for (let y = -8; y <= 8; y++)
      for (let x = -8; x <= 8; x++) if (x * x + y * y <= 64) px.push({ x: x + 40, y: y + 40 });
    const m = momentsFromPixels(px);
    expect(m.majorAxis / m.minorAxis).toBeLessThan(1.25);
    expect(m.eccentricity).toBeLessThan(0.4);
  });

  it('星形轮廓棱角数随尖角增加', () => {
    const contour: { x: number; y: number }[] = [];
    const spikes = 10;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? 30 : 18;
      const a = (i / (spikes * 2)) * Math.PI * 2;
      contour.push({ x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r });
    }
    const tips = detectTips(contour, 80, 1);
    expect(tips.length).toBeGreaterThanOrEqual(spikes - 3);
  });
});

describe('连通域与填洞', () => {
  it('并查集合并正确', () => {
    const uf = new UnionFind(6);
    uf.union(1, 2);
    uf.union(2, 3);
    expect(uf.find(1)).toBe(uf.find(3));
    expect(uf.find(4)).not.toBe(uf.find(1));
  });

  it('两个分离块得到两个标号，小碎块被过滤', () => {
    const w = 8;
    const mask = new Uint8Array(w * 8);
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [6, 6],
      [6, 7],
    ])
      mask[y * w + x] = 1;
    const { regions } = connectedComponents(mask, w, 8, 3);
    expect(regions.length).toBe(1); // 2 像素块被 minArea 过滤
    const all = connectedComponents(mask, w, 8, 1);
    expect(all.regions.length).toBe(2);
  });

  it('填洞把内部小背景补齐但不填大片间隙', () => {
    const w = 5;
    const mask = new Uint8Array(w * w);
    for (let x = 0; x < w; x++) {
      mask[x] = 1;
      mask[(w - 1) * w + x] = 1;
    }
    for (let y = 0; y < w; y++) {
      mask[y * w] = 1;
      mask[y * w + w - 1] = 1;
    }
    const filled = fillHoles(mask, w, w);
    expect(filled.every((v) => v === 1)).toBe(true); // 3×3 小孔被填
    // 大片背景（无包围）不应被填
    const open = new Uint8Array(w * w);
    const openFilled = fillHoles(open, w, w);
    expect(openFilled.every((v) => v === 0)).toBe(true);
  });

  it('轮廓追踪闭合且点数合理', () => {
    const pixels: { x: number; y: number }[] = [];
    for (let y = 10; y < 18; y++) for (let x = 10; x < 18; x++) pixels.push({ x, y });
    const contour = traceContour(pixels, 40, 40);
    expect(contour.length).toBeGreaterThan(20);
  });
});
