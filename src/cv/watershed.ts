/**
 * 大连通体拆分:距离变换 + 局部极大值种子 + 多源洪泛(watershed 简化版)。
 * 显微制片中结构互相接触/重叠,二值化后常连成一片;
 * 距离变换的每个局部极大值对应一个结构中心,以此为种子做洪泛可把粘连体拆开。
 */

/** 两遍 EDT(平方距离),Saito 算法的简化实现,适合本项目掩膜尺寸。 */
export function distanceTransform(mask: Float32Array, w: number, h: number): Float32Array {
  const dist = new Float32Array(w * h);
  const INF = 1e9;
  for (let i = 0; i < w * h; i++) dist[i] = mask[i] >= 0.5 ? INF : 0;

  // 前向扫描
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - w] + 1);
    }
  }
  // 后向扫描
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (dist[i] === 0) continue;
      if (x < w - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y < h - 1) dist[i] = Math.min(dist[i], dist[i + w] + 1);
    }
  }
  return dist;
}

/**
 * 在距离图上找局部极大值作为分水岭种子。
 * minSep:种子间最小间距(像素);minDist:只取距离值≥此阈值的种子,过滤碎屑。
 */
export function findSeeds(
  dist: Float32Array,
  w: number,
  h: number,
  minDist: number,
  minSep: number,
): number[] {
  const candidates: { idx: number; d: number }[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const d = dist[i];
      if (d < minDist) continue;
      // 8 邻域内最大
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (dist[i + dy * w + dx] > d) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) candidates.push({ idx: i, d });
    }
  }
  // 按距离降序,贪心保留满足最小间距的种子
  candidates.sort((a, b) => b.d - a.d);
  const seeds: number[] = [];
  for (const c of candidates) {
    const cx = c.idx % w;
    const cy = (c.idx / w) | 0;
    let ok = true;
    for (const s of seeds) {
      const sx = s % w;
      const sy = (s / w) | 0;
      if (Math.hypot(cx - sx, cy - sy) < minSep) {
        ok = false;
        break;
      }
    }
    if (ok) seeds.push(c.idx);
  }
  return seeds;
}

/**
 * 多源洪泛:从种子点同时向外扩展,每个掩膜像素归属最近的种子。
 * 返回与掩膜同尺寸的标签图(0=背景,1..k=种子编号)。
 */
export function watershedFlood(
  mask: Float32Array,
  seeds: number[],
  w: number,
  h: number,
): Int32Array {
  const labels = new Int32Array(w * h);
  if (seeds.length === 0) return labels;
  // 简单 BFS 队列(环形缓冲)
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  seeds.forEach((s, k) => {
    labels[s] = k + 1;
    queue[tail++] = s;
  });
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i / w) | 0;
    const lab = labels[i];
    const nbrs = [
      x > 0 ? i - 1 : -1,
      x < w - 1 ? i + 1 : -1,
      y > 0 ? i - w : -1,
      y < h - 1 ? i + w : -1,
    ];
    for (const nb of nbrs) {
      if (nb < 0 || labels[nb] !== 0 || mask[nb] < 0.5) continue;
      labels[nb] = lab;
      queue[tail++] = nb;
    }
  }
  return labels;
}

export interface SplitResult {
  labels: Int32Array;
  regionPixels: Int32Array[];
}

/**
 * 对一个大连通体执行分水岭拆分。
 * @param pixels 该连通体的像素索引
 * @param fullMask 全图掩膜
 */
export function splitRegion(
  pixels: Int32Array,
  _fullMask: Float32Array,
  w: number,
  h: number,
): SplitResult {
  // 构造该区域的局部掩膜
  const localMask = new Float32Array(w * h);
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let k = 0; k < pixels.length; k++) {
    const i = pixels[k];
    localMask[i] = 1;
    const x = i % w;
    const y = (i / w) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const dist = distanceTransform(localMask, w, h);
  // 种子只取距离图上的强峰值:最小距离取等效半径 45%,间距 60%,抑制纹理起伏造成的过分割
  const equivR = Math.sqrt(pixels.length / Math.PI);
  const minDist = Math.max(6, equivR * 0.45);
  const minSep = Math.max(16, equivR * 0.6);
  const seeds = findSeeds(dist, w, h, minDist, minSep);

  if (seeds.length <= 1) {
    // 拆不开,保持原区域
    const labels = new Int32Array(w * h);
    for (const i of pixels) labels[i] = 1;
    return { labels, regionPixels: [pixels] };
  }
  const labels = watershedFlood(localMask, seeds, w, h);
  const buckets = new Map<number, number[]>();
  for (const i of pixels) {
    const lab = labels[i];
    if (lab === 0) continue;
    const arr = buckets.get(lab) ?? [];
    arr.push(i);
    buckets.set(lab, arr);
  }
  return {
    labels,
    regionPixels: Array.from(buckets.values()).map((arr) => Int32Array.from(arr)),
  };
}
