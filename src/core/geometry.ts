// 二维几何：多边形面积/周长、凸包、图像矩、棱角曲率分析

export interface Pt {
  x: number;
  y: number;
}

export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(s) / 2;
}

export function polygonPerimeter(poly: Pt[]): number {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

/** Andrew 单调链凸包；输入过大时先等距抽稀，避免大数组排序爆栈 */
export function convexHull(pointsInput: Pt[]): Pt[] {
  if (pointsInput.length <= 2) return pointsInput.slice();
  const points = pointsInput.length > 4000 ? pointsInput.filter((_, i) => i % Math.ceil(pointsInput.length / 4000) === 0) : pointsInput;
  const pts = [...points].sort((a, b) => (a.x - b.x || a.y - b.y));
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export interface RegionMoments {
  area: number;
  cx: number;
  cy: number;
  majorAxis: number;
  minorAxis: number;
  eccentricity: number;
  orientation: number; // 弧度
}

/** 由像素坐标聚合的二阶中心矩求等效椭圆参数 */
export function momentsFromPixels(pixels: Pt[]): RegionMoments {
  const n = pixels.length;
  if (n === 0) {
    return { area: 0, cx: 0, cy: 0, majorAxis: 0, minorAxis: 0, eccentricity: 0, orientation: 0 };
  }
  let sx = 0,
    sy = 0;
  for (const p of pixels) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / n;
  const cy = sy / n;
  let mxx = 0,
    myy = 0,
    mxy = 0;
  for (const p of pixels) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    mxx += dx * dx;
    myy += dy * dy;
    mxy += dx * dy;
  }
  mxx /= n;
  myy /= n;
  mxy /= n;
  const common = Math.sqrt(((mxx - myy) / 2) ** 2 + mxy * mxy);
  const lambda1 = (mxx + myy) / 2 + common;
  const lambda2 = Math.max(0, (mxx + myy) / 2 - common);
  const majorAxis = 4 * Math.sqrt(lambda1);
  const minorAxis = 4 * Math.sqrt(lambda2);
  const eccentricity = lambda1 > 0 ? Math.sqrt(1 - lambda2 / lambda1) : 0;
  const orientation = 0.5 * Math.atan2(2 * mxy, mxx - myy);
  return { area: n, cx, cy, majorAxis, minorAxis, eccentricity, orientation };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 有序轮廓上的内角（度） */
export function interiorAngle(prev: Pt, cur: Pt, next: Pt): number {
  const v1x = prev.x - cur.x;
  const v1y = prev.y - cur.y;
  const v2x = next.x - cur.x;
  const v2y = next.y - cur.y;
  const dot = v1x * v2x + v1y * v2y;
  const cross = v1x * v2y - v1y * v2x;
  let ang = Math.atan2(Math.abs(cross), dot) * (180 / Math.PI);
  if (ang < 0) ang += 180;
  return ang; // 0..180
}

export interface TipInfo {
  point: Pt;
  angle: number;
}

/**
 * 棱角检测：弦窗按轮廓周长自适应（约 1/40 周长），
 * 局部极小内角（尖点）视为棱角，返回角度列表。
 */
export function detectTips(contour: Pt[], _sampleCount = 64, chordHint = 3): TipInfo[] {
  const n = contour.length;
  if (n < 10) return [];
  // 弦窗随轮廓尺度缩放，保证大/小目标都能捕获尖端 V 形夹角
  const win = Math.max(3, Math.min(Math.floor(n / 6), Math.round(n / 40), Math.max(chordHint, 3)));
  const angles: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = contour[(i - win + n) % n];
    const cur = contour[i];
    const next = contour[(i + win) % n];
    angles[i] = interiorAngle(prev, cur, next);
  }
  const tips: TipInfo[] = [];
  const minSpacing = Math.max(2, Math.round(n / 24));
  for (let i = 0; i < n; i++) {
    const a = angles[i];
    if (a >= 118) continue;
    let isMin = true;
    for (let k = 1; k <= win; k++) {
      if (angles[(i - k + n) % n] < a - 1e-9 || angles[(i + k) % n] < a - 1e-9) {
        isMin = false;
        break;
      }
    }
    if (!isMin) continue;
    if (tips.every((t) => Math.hypot(t.point.x - contour[i].x, t.point.y - contour[i].y) > minSpacing)) {
      tips.push({ point: contour[i], angle: a });
    }
  }
  return tips;
}

/** 径向对称性：质心到边界距离的变异系数反转，越圆越接近 1 */
export function radialSymmetry(contour: Pt[], cx: number, cy: number): number {
  if (contour.length < 6) return 0;
  const rs = contour.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  if (m === 0) return 0;
  const v = rs.reduce((a, b) => a + (b - m) ** 2, 0) / rs.length;
  const cv = Math.sqrt(v) / m;
  return Math.max(0, 1 - cv);
}

/** Douglas-Peucker 多边形抽稀（迭代实现，避免大轮廓递归栈溢出） */
export function simplifyPolygon(points: Pt[], epsilon: number): Pt[] {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = pointLineDistance(points[i], points[first], points[last]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx > -1 && maxD > epsilon) {
      keep[idx] = true;
      stack.push([first, idx]);
      stack.push([idx, last]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function pointLineDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
