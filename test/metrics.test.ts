import { describe, it, expect } from 'vitest';
import { evaluate, iou } from '../src/evaluation/metrics';
import type { Annotation } from '../src/types';
import type { GtObject } from '../src/synthetic/generator';

function gt(type: GtObject['type'], x: number, y: number): GtObject {
  return {
    type, cx: x + 20, cy: y + 20,
    bbox: { x, y, w: 40, h: 40 },
    params: {},
  };
}

function ann(type: Annotation['type'], x: number, y: number): Annotation {
  return {
    id: `a-${x}-${y}`, type, cx: x + 20, cy: y + 20,
    bbox: { x, y, w: 40, h: 40 }, source: 'auto', confidence: 0.9,
  };
}

describe('metrics', () => {
  it('IoU 完全重叠=1,不相交=0', () => {
    const b = { x: 0, y: 0, w: 10, h: 10 };
    expect(iou(b, b)).toBe(1);
    expect(iou(b, { x: 50, y: 50, w: 10, h: 10 })).toBe(0);
  });

  it('全对:综合准确率 100%', () => {
    const g = [gt('starch', 0, 0), gt('vessel', 100, 100), gt('fiber', 200, 200)];
    const a = [ann('starch', 0, 0), ann('vessel', 100, 100), ann('fiber', 200, 200)];
    const rep = evaluate(g, a, a.map((x) => ({
      id: 1, bbox: x.bbox, cx: x.cx, cy: x.cy,
    })));
    expect(rep.overallAccuracy).toBe(1);
    expect(rep.macroF1).toBeGreaterThan(0);
  });

  it('错类计入混淆矩阵且拉低准确率', () => {
    const g = [gt('starch', 0, 0)];
    const a = [ann('pollen', 0, 0)];
    const rep = evaluate(g, a, a.map((x) => ({
      id: 1, bbox: x.bbox, cx: x.cx, cy: x.cy,
    })));
    expect(rep.overallAccuracy).toBe(0);
    expect(rep.confusion.starch?.pollen).toBe(1);
  });

  it('漏检与误检:FP/FN 正确统计', () => {
    const g = [gt('starch', 0, 0)];
    const a = [ann('starch', 0, 0), ann('vessel', 300, 300)];
    const rep = evaluate(g, a, a.map((x) => ({
      id: 1, bbox: x.bbox, cx: x.cx, cy: x.cy,
    })));
    const starch = rep.perClass.find((c) => c.type === 'starch')!;
    const vessel = rep.perClass.find((c) => c.type === 'vessel')!;
    expect(starch.recall).toBe(1);
    expect(vessel.fp).toBe(1);
  });
});
