// CPU 侧二值图像算法：连通域（并查集）、填洞、轮廓追踪、峰点标记生成
import type { BBox } from './types';

export interface Pt {
  x: number;
  y: number;
}

export class UnionFind {
  parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    let cur = x;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur];
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

export interface Region {
  id: number;
  pixels: Pt[];
  bbox: BBox;
  area: number;
  centroid: Pt;
}

/** 4 邻域连通域标号，返回每像素标号（0 背景）与区域列表（含全部像素） */
export function connectedComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  minArea = 12,
): { labels: Int32Array; regions: Region[] } {
  const n = w * h;
  const uf = new UnionFind(n + 1);
  const local = new Int32Array(n);
  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const up = y > 0 ? local[i - w] : 0;
      const left = x > 0 ? local[i - 1] : 0;
      if (up === 0 && left === 0) {
        local[i] = next++;
      } else if (up !== 0 && left === 0) {
        local[i] = up;
      } else if (up === 0 && left !== 0) {
        local[i] = left;
      } else {
        local[i] = Math.min(up, left);
        uf.union(up, left);
      }
    }
  }
  const rootMap = new Map<number, number>();
  const labels = new Int32Array(n);
  let label = 0;
  for (let i = 0; i < n; i++) {
    if (local[i] === 0) continue;
    const root = uf.find(local[i]);
    let mapped = rootMap.get(root);
    if (mapped === undefined) {
      mapped = ++label;
      rootMap.set(root, mapped);
    }
    labels[i] = mapped;
  }
  const buckets = new Map<number, Pt[]>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lab = labels[y * w + x];
      if (!lab) continue;
      let arr = buckets.get(lab);
      if (!arr) {
        arr = [];
        buckets.set(lab, arr);
      }
      arr.push({ x, y });
    }
  }
  const regions: Region[] = [];
  for (const [id, pixels] of buckets) {
    if (pixels.length < minArea) {
      for (const p of pixels) labels[p.y * w + p.x] = 0;
      continue;
    }
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0,
      sx = 0,
      sy = 0;
    for (const p of pixels) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      sx += p.x;
      sy += p.y;
    }
    regions.push({
      id,
      pixels,
      area: pixels.length,
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      centroid: { x: sx / pixels.length, y: sy / pixels.length },
    });
  }
  regions.sort((a, b) => a.id - b.id);
  return { labels, regions };
}

/**
 * 填洞：从边界背景做泛洪标记外部；未被访问的背景像素即孔洞。
 * maxHolePx 限制只填目标内部小孔，避免把目标间隙的大片背景误填导致粘连。
 */
export function fillHoles(mask: Uint8Array, w: number, h: number, maxHolePx = 400): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (!outside[i] && !mask[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  // 对未触边界的内部背景块逐块统计，仅填补小于阈值的孔
  const out = new Uint8Array(mask);
  const visited = new Uint8Array(w * h);
  for (let seed = 0; seed < w * h; seed++) {
    if (mask[seed] || outside[seed] || visited[seed]) continue;
    const component: number[] = [];
    const st: number[] = [seed];
    visited[seed] = 1;
    while (st.length) {
      const i = st.pop()!;
      component.push(i);
      const x = i % w;
      const y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const ni of nb) {
        if (ni >= 0 && !mask[ni] && !outside[ni] && !visited[ni]) {
          visited[ni] = 1;
          st.push(ni);
        }
      }
    }
    if (component.length <= maxHolePx) {
      for (const i of component) out[i] = 1;
    }
  }
  return out;
}

/** Moore 邻域轮廓追踪，返回有序边界点 */
export function traceContour(pixels: Pt[], w: number, h: number): Pt[] {
  if (pixels.length === 0) return [];
  const inRegion = new Set<number>(pixels.map((p) => p.y * w + p.x));
  // 取最上再最左的点为起点
  let start = pixels[0];
  for (const p of pixels) {
    if (p.y < start.y || (p.y === start.y && p.x < start.x)) start = p;
  }
  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const contour: Pt[] = [start];
  let cur = start;
  let dir = 6; // 初始朝上方向的邻域
  const maxSteps = pixels.length * 4 + 16;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + k) % 8;
      const nx = cur.x + dirs[d][0];
      const ny = cur.y + dirs[d][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (inRegion.has(ny * w + nx)) {
        cur = { x: nx, y: ny };
        dir = (d + 6) % 8; // 回溯两个方向作为下一起始搜索方向
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cur.x === start.x && cur.y === start.y) break;
    contour.push(cur);
  }
  return contour;
}

/**
 * 由距离图在各连通域内找局部极大（h-maxima 简化版），
 * 每个极大点生成一个分水岭种子标号；单峰区域也保证有一个种子。
 */
export function buildWatershedMarkers(
  dist: Float32Array,
  _labels: Int32Array,
  regions: Region[],
  w: number,
  h: number,
  minPeakDist = 5,
): { markers: Int32Array; peakCountByRegion: Map<number, number> } {
  const markers = new Int32Array(w * h);
  const peakCountByRegion = new Map<number, number>();
  let markerId = 0;
  const placed: Pt[] = [];
  for (const region of regions) {
    const candidates: { p: Pt; d: number }[] = [];
    let maxD = 0;
    for (const p of region.pixels) {
      const d = dist[p.y * w + p.x];
      if (d > maxD) maxD = d;
    }
    const peakThresh = Math.max(2.5, maxD * 0.55);
    for (const p of region.pixels) {
      const i = p.y * w + p.x;
      const d = dist[i];
      if (d < peakThresh) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = p.x + dx;
          const ny = p.y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (dist[ny * w + nx] > d + 1e-6) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) candidates.push({ p, d });
    }
    candidates.sort((a, b) => b.d - a.d);
    // 峰间距按目标尺度自适应：取目标内切半径量级，既能分开接触的相邻结构，又不拆碎单体
    const adaptiveMinDist = Math.max(minPeakDist, Math.round(maxD * 0.9));
    const regionPeaks: Pt[] = [];
    for (const c of candidates) {
      if (regionPeaks.every((q) => Math.hypot(q.x - c.p.x, q.y - c.p.y) >= adaptiveMinDist)) {
        regionPeaks.push(c.p);
      }
    }
    if (regionPeaks.length === 0) {
      regionPeaks.push({ ...region.centroid });
    }
    let count = 0;
    for (const p of regionPeaks) {
      const id = ++markerId;
      markers[p.y * w + p.x] = id;
      placed.push(p);
      count++;
    }
    peakCountByRegion.set(region.id, count);
  }
  void placed;
  return { markers, peakCountByRegion };
}
