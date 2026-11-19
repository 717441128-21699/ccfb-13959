// 数值工具：可复现随机数、模糊隶属、统计与一维聚类

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 可复现伪随机数（mulberry32） */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** 截断高斯 */
  gaussian(mean: number, sd: number): number {
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + z * sd;
  }
  gaussianClamped(mean: number, sd: number, lo: number, hi: number): number {
    return clamp(this.gaussian(mean, sd), lo, hi);
  }
  bool(p: number): boolean {
    return this.next() < p;
  }
}

/** 梯形模糊隶属：区间内为 1，tol 宽度内线性衰减到 0 */
export function fuzzyMembership(value: number, lo: number, hi: number, tol = 0): number {
  if (tol <= 0) return value >= lo && value <= hi ? 1 : 0;
  if (value < lo - tol || value > hi + tol) return 0;
  if (value < lo) return (value - (lo - tol)) / tol;
  if (value > hi) return (hi + tol - value) / tol;
  return 1;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = clamp(Math.round((p / 100) * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

/** 一维 k-means（k=2），返回两簇中心与归属；用于掺伪双峰检验 */
export function kmeans1d(
  xs: number[],
): { centers: [number, number]; labels: number[]; separated: boolean; gap: number } {
  if (xs.length < 4) {
    const m = mean(xs);
    return { centers: [m, m], labels: xs.map(() => 0), separated: false, gap: 0 };
  }
  const sorted = [...xs].sort((a, b) => a - b);
  let c0 = sorted[Math.floor(sorted.length * 0.25)];
  let c1 = sorted[Math.floor(sorted.length * 0.75)];
  if (c0 === c1) c1 = c0 + 1e-6;
  const labels = new Array<number>(xs.length).fill(0);
  for (let iter = 0; iter < 30; iter++) {
    let s0 = 0,
      n0 = 0,
      s1 = 0,
      n1 = 0;
    for (let i = 0; i < xs.length; i++) {
      const d0 = Math.abs(xs[i] - c0);
      const d1 = Math.abs(xs[i] - c1);
      const lab = d0 <= d1 ? 0 : 1;
      labels[i] = lab;
      if (lab === 0) {
        s0 += xs[i];
        n0++;
      } else {
        s1 += xs[i];
        n1++;
      }
    }
    const nc0 = n0 ? s0 / n0 : c0;
    const nc1 = n1 ? s1 / n1 : c1;
    if (Math.abs(nc0 - c0) < 1e-4 && Math.abs(nc1 - c1) < 1e-4) break;
    c0 = nc0;
    c1 = nc1;
  }
  if (c0 > c1) {
    [c0, c1] = [c1, c0];
    for (let i = 0; i < labels.length; i++) labels[i] = 1 - labels[i];
  }
  const globalSd = std(xs);
  const withinSd = Math.max(
    ...labels.map((lab) => std(xs.filter((_, i) => labels[i] === lab))),
    1e-9,
  );
  const gap = c1 - c0;
  // 双峰判据：绝对间距成规模、簇内离散远小于簇间；单簇抖动时间距与簇内离散同量级
  const separated = gap > 2.2 * withinSd && globalSd > withinSd * 1.15 && gap > 3;
  return { centers: [c0, c1], labels, separated, gap: gap / (globalSd || 1e-9) };
}

/** 双峰/二态性检验：两簇都有足够样本且中心显著分离 */
export function isBimodal(xs: number[], minEach = 2): boolean {
  if (xs.length < minEach * 2) return false;
  const km = kmeans1d(xs);
  const n1 = km.labels.reduce((a, b) => a + b, 0);
  return n1 >= minEach && xs.length - n1 >= minEach && km.separated;
}

export function softmaxScores(raw: Record<string, number>): Record<string, number> {
  const entries = Object.entries(raw);
  if (entries.length === 0) return {};
  const max = Math.max(...entries.map(([, v]) => v));
  const exps = entries.map(([k, v]) => [k, Math.exp(v - max)] as const);
  const sum = exps.reduce((a, [, e]) => a + e, 0);
  return Object.fromEntries(exps.map(([k, e]) => [k, e / sum]));
}

/** 加权求和的便利函数 */
export function weightedSum(terms: { value: number; weight: number }[]): number {
  let s = 0;
  let w = 0;
  for (const t of terms) {
    s += t.value * t.weight;
    w += t.weight;
  }
  return w > 0 ? s / w : 0;
}
