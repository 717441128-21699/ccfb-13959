/** 纯函数几何工具:矩、凸包(Andrew 单调链)、多边形周长与夹角统计。 */

export interface Point {
  x: number;
  y: number;
}

export interface HullResult {
  hull: Point[];
  area: number;
  perimeter: number;
}

/** 由像素集合计算质心、二阶中心矩、长轴方向与长短轴。 */
export function moments(pixels: Int32Array, width: number) {
  let m00 = 0;
  let m10 = 0;
  let m01 = 0;
  for (let i = 0; i < pixels.length; i++) {
    const idx = pixels[i];
    const x = idx % width;
    const y = (idx / width) | 0;
    m00++;
    m10 += x;
    m01 += y;
  }
  if (m00 === 0) return null;
  const cx = m10 / m00;
  const cy = m01 / m00;
  let mu20 = 0;
  let mu02 = 0;
  let mu11 = 0;
  for (let i = 0; i < pixels.length; i++) {
    const idx = pixels[i];
    const x = idx % width;
    const y = (idx / width) | 0;
    const dx = x - cx;
    const dy = y - cy;
    mu20 += dx * dx;
    mu02 += dy * dy;
    mu11 += dx * dy;
  }
  // 图像二阶矩的特征值 → 等效椭圆长短轴
  const common = Math.sqrt(Math.max(0, 4 * mu11 * mu11 + (mu20 - mu02) * (mu20 - mu02)));
  const major = Math.sqrt(Math.max(1, 2 * (mu20 + mu02 + common) / m00));
  const minor = Math.sqrt(Math.max(1, 2 * (mu20 + mu02 - common) / m00));
  const orientation = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
  return { cx, cy, m00, major, minor, orientation };
}

/** Andrew 单调链凸包。 */
export function convexHull(points: Point[]): Point[] {
  if (points.length <= 1) return points.slice();
  const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
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

export function polygonPerimeter(hull: Point[]): number {
  let p = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    p += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return p;
}

export function polygonArea(hull: Point[]): number {
  let a = 0;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) * 0.5;
}

/**
 * 凸包顶点夹角锐度:夹角越小越尖锐。
 * 归一化:180°(直线,钝)→0;30°(锐角)→1。
 */
export function hullSharpness(hull: Point[]): { sharpness: number; vertices: number } {
  if (hull.length < 3) return { sharpness: 0, vertices: hull.length };
  let sum = 0;
  let n = 0;
  for (let i = 0; i < hull.length; i++) {
    const prev = hull[(i - 1 + hull.length) % hull.length];
    const cur = hull[i];
    const next = hull[(i + 1) % hull.length];
    const v1x = prev.x - cur.x;
    const v1y = prev.y - cur.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const cos = (v1x * v2x + v1y * v2y) /
      (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) + 1e-9);
    const angle = Math.acos(Math.max(-1, Math.min(1, cos))); // 0..π
    const sharp = Math.max(0, Math.min(1, (Math.PI - angle) / (Math.PI - Math.PI / 6)));
    sum += sharp;
    n++;
  }
  return { sharpness: sum / n, vertices: n };
}

/** 4 邻域边界像素数近似周长。 */
export function boundaryPerimeter(width: number, height: number, label: number,
  labels: Int32Array): number {
  let p = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (labels[i] !== label) continue;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        labels[i - 1] !== label || labels[i + 1] !== label ||
        labels[i - width] !== label || labels[i + width] !== label) {
        p++;
      }
    }
  }
  return p;
}

/**
 * 从掩膜区域提取有序轮廓链(边界像素按绕质心极角排序近似)。
 * 对簇晶这类星状目标,轮廓链保留了凸包单调链会丢弃的尖刺顶点,
 * 因此棱角锐度应在轮廓链而不是凸包上计算。
 */
export function boundaryChain(
  labels: Int32Array,
  label: number,
  width: number,
  height: number,
): Point[] {
  const boundary: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (labels[i] !== label) continue;
      const isEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        labels[i - 1] !== label || labels[i + 1] !== label ||
        labels[i - width] !== label || labels[i + width] !== label;
      if (isEdge) boundary.push({ x, y });
    }
  }
  if (boundary.length < 3) return boundary;
  let cx = 0;
  let cy = 0;
  for (const p of boundary) {
    cx += p.x;
    cy += p.y;
  }
  cx /= boundary.length;
  cy /= boundary.length;
  boundary.sort((a, b) =>
    Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // 抽稀:间距 ≥2px 才保留,控制顶点数
  const chain: Point[] = [];
  for (const p of boundary) {
    const last = chain[chain.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 2) chain.push(p);
  }
  return chain;
}
