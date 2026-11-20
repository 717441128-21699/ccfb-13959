/**
 * 连通域分析(两遍并查集)+ 形态学描述子提取。
 * 输入 GpuPipeline 回读的打包缓冲(R=掩膜 G=边缘 B=归一化亮度 A=原始亮度)。
 */
import type { RegionFeatures, StructureType, VesselKind } from '../types';
import {
  moments,
  convexHull,
  polygonPerimeter,
  polygonArea,
  hullSharpness,
  boundaryChain,
  type Point,
} from './geometry';
import { classifyRegion } from './classifier';
import { splitRegion } from './watershed';

/**
 * 连通域标记:单次扫描 + BFS 洪泛,4 邻域。
 * 比两遍并查集更直观可靠,避免路径压缩与合并方向的边界问题。
 */
export interface LabelResult {
  labels: Int32Array;
  /** 每个标签对应的像素索引(紧凑数组) */
  regionPixels: Int32Array[];
}

export function labelComponents(mask: Float32Array, w: number, h: number): LabelResult {
  const labels = new Int32Array(w * h);
  const regionPixels: Int32Array[] = [];
  const queue = new Int32Array(w * h);
  let nextLabel = 1;

  for (let start = 0; start < w * h; start++) {
    if (mask[start] < 0.5 || labels[start] !== 0) continue;
    const label = nextLabel++;
    const pixels: number[] = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    while (head < tail) {
      const i = queue[head++];
      pixels.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      // 4 邻域
      if (x > 0) {
        const nb = i - 1;
        if (mask[nb] >= 0.5 && labels[nb] === 0) {
          labels[nb] = label;
          queue[tail++] = nb;
        }
      }
      if (x < w - 1) {
        const nb = i + 1;
        if (mask[nb] >= 0.5 && labels[nb] === 0) {
          labels[nb] = label;
          queue[tail++] = nb;
        }
      }
      if (y > 0) {
        const nb = i - w;
        if (mask[nb] >= 0.5 && labels[nb] === 0) {
          labels[nb] = label;
          queue[tail++] = nb;
        }
      }
      if (y < h - 1) {
        const nb = i + w;
        if (mask[nb] >= 0.5 && labels[nb] === 0) {
          labels[nb] = label;
          queue[tail++] = nb;
        }
      }
    }
    regionPixels.push(Int32Array.from(pixels));
  }
  return { labels, regionPixels };
}

/** 区域内暗局部极小值计数(纹孔/凹穴的代理量)。 */
function countDarkPits(norm: Float32Array, pixels: Int32Array, w: number, h: number): number {
  const inRegion = new Set<number>();
  for (let i = 0; i < pixels.length; i++) inRegion.add(pixels[i]);
  let pits = 0;
  for (let k = 0; k < pixels.length; k++) {
    const i = pixels[k];
    const x = i % w;
    const y = (i / w) | 0;
    const v = norm[i];
    if (v >= 0.42) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
    if (norm[i - 1] >= v && norm[i + 1] >= v && norm[i - w] >= v && norm[i + w] >= v) {
      pits++;
    }
  }
  return pits;
}

/** bbox 内被掩膜包围的孔洞面积(flood fill 从 bbox 边界外扩)。 */
function holeArea(labels: Int32Array, label: number, bbox: { x: number; y: number; w: number; h: number },
  w: number, h: number): number {
  const x0 = Math.max(0, bbox.x - 1);
  const y0 = Math.max(0, bbox.y - 1);
  const x1 = Math.min(w - 1, bbox.x + bbox.w);
  const y1 = Math.min(h - 1, bbox.y + bbox.h);
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  const tryPush = (i: number) => {
    if (!visited[i] && labels[i] !== label) {
      visited[i] = 1;
      stack.push(i);
    }
  };
  for (let x = x0; x <= x1; x++) {
    tryPush(y0 * w + x);
    tryPush(y1 * w + x);
  }
  for (let y = y0; y <= y1; y++) {
    tryPush(y * w + x0);
    tryPush(y * w + x1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > x0) tryPush(i - 1);
    if (x < x1) tryPush(i + 1);
    if (y > y0) tryPush(i - w);
    if (y < y1) tryPush(i + w);
  }
  let holes = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (labels[i] !== label && !visited[i]) holes++;
    }
  }
  return holes;
}

function detectVesselKind(ar: number, edge: number, dark: number, pits: number, perimeter: number): VesselKind {
  const pitRate = pits / Math.max(1, perimeter);
  if (ar < 2.2) {
    // 短粗导管多为具缘纹孔
    return pitRate > 0.04 || dark > 0.28 ? 'bordered_pit' : 'pitted';
  }
  if (edge > 0.32) return 'reticulate';
  if (pitRate > 0.05) return 'pitted';
  if (dark < 0.18) return 'spiral';
  return 'annular';
}

/** 主入口:从打包像素缓冲提取全部区域特征并完成分类。 */
export function extractFeatures(packed: Float32Array, w: number, h: number): RegionFeatures[] {
  const sampled = new Float32Array(w * h);
  const edge = new Float32Array(w * h);
  const norm = new Float32Array(w * h);
  const rawLuma = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    sampled[i] = packed[i * 4];
    edge[i] = packed[i * 4 + 1];
    norm[i] = packed[i * 4 + 2];
    rawLuma[i] = packed[i * 4 + 3]; // 白平衡后的原始亮度,保留亮/暗结构区分
  }
  const { labels: rawLabels, regionPixels: rawRegions } = labelComponents(sampled, w, h);

  // 分水岭拆分:只有面积显著超过单结构上限(>8000px)才视为粘连体,
  // 避免把单个大结构(大簇晶/石细胞群)错误切碎
  const MERGE_AREA = 8000;
  const regionPixels: Int32Array[] = [];
  for (const rp of rawRegions) {
    if (rp.length >= MERGE_AREA) {
      const split = splitRegion(rp, sampled, w, h);
      if (split.regionPixels.length > 1) {
        regionPixels.push(...split.regionPixels);
      } else {
        regionPixels.push(rp);
      }
    } else {
      regionPixels.push(rp);
    }
  }
  // 用拆分结果重建标签图
  const labels = new Int32Array(w * h);
  regionPixels.forEach((rp, k) => {
    for (let i = 0; i < rp.length; i++) labels[rp[i]] = k + 1;
  });
  void rawLabels;
  const results: RegionFeatures[] = [];
  let id = 0;

  for (const pixels of regionPixels) {
    const area = pixels.length;
    if (area < 120) continue; // 去噪:小于 120px 的碎屑/噪点丢弃
    id++;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    let darkCount = 0;
    let lumaSum = 0;
    let edgeSum = 0;
    const pts: Point[] = new Array(pixels.length);
    for (let k = 0; k < pixels.length; k++) {
      const i = pixels[k];
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (rawLuma[i] < 0.45) darkCount++;
      lumaSum += rawLuma[i];
      // Sobel 边缘图经 8 位量化,阈值取 0.45 才对应真实强边缘
      if (edge[i] > 0.45) edgeSum++;
      pts[k] = { x, y };
    }
    const bbox = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    const m = moments(pixels, w);
    if (!m) continue;
    const hull = convexHull(pts);
    const hullArea = Math.max(1, polygonArea(hull));
    const hullPerim = polygonPerimeter(hull);
    // 周长取轮廓链与凸包的较大者,避免轮廓链抽稀导致周长偏小、圆度>1
    const chain = boundaryChain(labels, id, w, h);
    const chainPerim = chain.length >= 3 ? polygonPerimeter(chain) : 0;
    const perimeter = Math.max(hullPerim, chainPerim);
    // 锐度在轮廓链上计算(凸包会削掉簇晶尖刺);凸包顶点数另作描述子
    const { sharpness } = hullSharpness(chain.length >= 3 ? chain : hull);
    const vertices = hull.length;
    const equivDiameter = 2 * Math.sqrt(area / Math.PI);
    // 圆度理论范围 0..1,钳制防止数值噪声越界
    const circularity = Math.max(0, Math.min(1, (4 * Math.PI * area) / Math.max(1, perimeter * perimeter)));
    const aspectRatio = m.major / Math.max(0.5, m.minor);
    const solidity = Math.max(0, Math.min(1, area / hullArea));
    const darkRatio = darkCount / area;
    const edgeDensity = edgeSum / area;
    const pits = countDarkPits(norm, pixels, w, h);
    // 纹孔密度:单位轮廓长度上的暗穴数,归一化到 0~1 量级
    const pitDensity = Math.min(1, pits / Math.max(1, hullPerim));
    const holes = holeArea(labels, id, bbox, w, h);
    const lumenD = 2 * Math.sqrt(holes / Math.PI);
    const wallLumenRatio = holes > 4
      ? Math.max(0.2, (m.minor - lumenD) / Math.max(1, lumenD))
      : 4; // 无腔孔 → 实心厚壁
    const solidElongated = holes <= 4;
    const vesselKind = detectVesselKind(aspectRatio, edgeDensity, darkRatio, pits, hullPerim);

    const base: RegionFeatures = {
      id,
      type: 'unknown',
      confidence: 0,
      classScores: {},
      cx: m.cx,
      cy: m.cy,
      area,
      perimeter,
      bbox,
      equivDiameter,
      circularity,
      aspectRatio,
      solidity,
      darkRatio,
      meanNormLuma: lumaSum / area,
      edgeDensity,
      orientation: m.orientation,
      convexVertices: vertices,
      crystalSharpness: sharpness,
      pitDensity,
      vesselKind,
      wallLumenRatio,
      solidElongated,
    };
    const { type, confidence, scores } = classifyRegion(base);
    base.type = type;
    base.confidence = confidence;
    base.classScores = scores;
    results.push(base);
  }
  return results;
}

export function countByType(regions: RegionFeatures[]): Record<StructureType, number> {
  const counts: Record<StructureType, number> = {
    calcium_cluster: 0, calcium_needle: 0, stone_cell: 0, vessel: 0,
    fiber: 0, starch: 0, pollen: 0,
  };
  for (const r of regions) {
    if (r.type !== 'unknown') counts[r.type as StructureType]++;
  }
  return counts;
}
