// 程序化显微结构绘制原语（Canvas2D），形态参数与药典区间对齐
import type { StructureType, VesselPattern } from '../core/types';
import { Rng, clamp } from '../core/mathUtils';

export interface StainPreset {
  id: string;
  name: string;
  bg: [number, number, number];
  stain: [number, number, number]; // 染色主色
  intensity: number; // 整体染色深浅
  warmth: number; // 偏色
  gamma: number;
}

export const STAIN_PRESETS: StainPreset[] = [
  { id: 'standard', name: '标准水合氯醛', bg: [238, 234, 224], stain: [150, 110, 70], intensity: 0.55, warmth: 0, gamma: 1.0 },
  { id: 'pale', name: '染色偏浅/换检验员A', bg: [244, 242, 236], stain: [196, 176, 148], intensity: 0.32, warmth: -0.08, gamma: 1.25 },
  { id: 'deep', name: '染色偏深/换检验员B', bg: [224, 214, 196], stain: [96, 62, 34], intensity: 0.78, warmth: 0.1, gamma: 0.82 },
  { id: 'cool', name: '偏冷色调显微光源', bg: [226, 230, 232], stain: [110, 120, 138], intensity: 0.5, warmth: 0.22, gamma: 1.05 },
];

export function stainColor(preset: StainPreset, alpha: number, shade = 1): string {
  const [r, g, b] = preset.stain.map((c) => {
    const warmed = c + preset.warmth * 40 * shade;
    const v = 255 - (255 - warmed) * preset.intensity * shade;
    return Math.round(clamp(v, 0, 255));
  });
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

export function drawBackground(ctx: CanvasRenderingContext2D, size: number, rng: Rng, preset: StainPreset): void {
  const [br, bg, bb] = preset.bg;
  ctx.fillStyle = `rgb(${br},${bg},${bb})`;
  ctx.fillRect(0, 0, size, size);
  // 细碎背景颗粒与不均匀照明
  for (let i = 0; i < size * 14; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const a = rng.range(0.015, 0.07);
    const v = rng.bool(0.5) ? 30 : -30;
    ctx.fillStyle = `rgba(${br + v},${bg + v},${bb + v},${a})`;
    ctx.fillRect(x, y, rng.range(0.5, 1.6), rng.range(0.5, 1.6));
  }
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.75);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, `rgba(40,30,20,${0.1 * preset.intensity + 0.05})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
}

/** 簇晶：放射状多棱晶体，tipAngle 越小棱角越锐 */
export function drawClusterCrystal(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  preset: StainPreset,
  x: number,
  y: number,
  radius: number,
  tipAngle: number,
  tipCount: number,
): void {
  const rot = rng.range(0, Math.PI * 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.lineJoin = 'round';
  for (let k = 0; k < tipCount; k++) {
    const a = (k / tipCount) * Math.PI * 2 + rng.range(-0.08, 0.08);
    // 棱角越钝，尖端半径越大
    const blunt = clamp((tipAngle - 10) / 90, 0, 1);
    const halfBase = radius * (0.16 + blunt * 0.22);
    const len = radius * rng.range(0.72, 1.05);
    const bx1 = Math.cos(a - 0.34) * halfBase;
    const by1 = Math.sin(a - 0.34) * halfBase;
    const bx2 = Math.cos(a + 0.34) * halfBase;
    const by2 = Math.sin(a + 0.34) * halfBase;
    const tx = Math.cos(a) * len;
    const ty = Math.sin(a) * len;
    const shade = rng.range(0.7, 1.25);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(bx1, by1);
    ctx.lineTo(tx, ty);
    ctx.lineTo(bx2, by2);
    ctx.closePath();
    ctx.fillStyle = stainColor(preset, rng.range(0.55, 0.8), shade);
    ctx.fill();
    ctx.strokeStyle = stainColor(preset, 0.85, shade * 0.7);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // 晶面折光线
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = `rgba(255,255,255,${rng.range(0.18, 0.4)})`;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  ctx.restore();
}

/** 方晶：近方形/菱形晶体 */
export function drawPrism(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  preset: StainPreset,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rng.range(0, Math.PI / 2));
  const w = r * rng.range(0.85, 1.25);
  const h = r * rng.range(0.8, 1.15);
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(0, -h);
  ctx.lineTo(w, 0);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = stainColor(preset, rng.range(0.55, 0.75));
  ctx.fill();
  ctx.strokeStyle = stainColor(preset, 0.85, 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(w, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
  ctx.restore();
}

/** 石细胞：壁厚多角形，可分枝；pitDensity 控制壁上纹孔疏密 */
export function drawStoneCell(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  preset: StainPreset,
  x: number,
  y: number,
  r: number,
  opts: { wallRatio: number; pitDensity: number; branches: number; solidity: number },
): void {
  const verts = rng.int(7, 11);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < verts; i++) {
    const a = (i / verts) * Math.PI * 2;
    let rr = r * rng.range(0.82, 1.05);
    if (opts.branches > 0 && i < opts.branches) rr = r * rng.range(1.25, 1.6);
    pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
  }
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  };
  ctx.save();
  path();
  ctx.fillStyle = stainColor(preset, rng.range(0.6, 0.8));
  ctx.fill();
  ctx.strokeStyle = stainColor(preset, 0.9, 0.6);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // 内腔
  const inner = Math.max(2, r * (1 - opts.wallRatio) * 1.35);
  ctx.beginPath();
  ctx.ellipse(x, y, inner * rng.range(0.8, 1.05), inner * rng.range(0.75, 1), rng.range(0, 3), 0, Math.PI * 2);
  ctx.fillStyle = stainColor(preset, 0.18, 1.3);
  ctx.fill();
  ctx.strokeStyle = stainColor(preset, 0.5, 0.7);
  ctx.stroke();
  // 层纹（同心细线）
  for (let ring = 0; ring < 2; ring++) {
    ctx.beginPath();
    ctx.ellipse(x, y, inner + (ring + 1) * r * 0.12, inner + (ring + 1) * r * 0.1, 0, 0, Math.PI * 2);
    ctx.strokeStyle = stainColor(preset, 0.25, 0.65);
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  // 壁上纹孔：沿轮廓撒暗点，密度对应 pitDensity（每 100μm；这里 r 单位 px≈0.5μm）
  const pitCount = Math.round((opts.pitDensity / 100) * (2 * Math.PI * r * 0.5) * 2.2);
  for (let i = 0; i < pitCount; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = rng.range(inner + 1, r * 0.98);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    ctx.beginPath();
    ctx.arc(px, py, rng.range(0.7, 1.4), 0, Math.PI * 2);
    ctx.fillStyle = stainColor(preset, rng.range(0.55, 0.8), 0.55);
    ctx.fill();
  }
  ctx.restore();
}

/** 导管：长圆筒，内部画纹理亚型 */
export function drawVessel(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  preset: StainPreset,
  x: number,
  y: number,
  length: number,
  width: number,
  angle: number,
  pattern: VesselPattern,
  pitDensity: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const L = length / 2;
  const W = width / 2;
  ctx.beginPath();
  roundRectPath(ctx, -L, -W, length, width, W * 0.5);
  ctx.fillStyle = stainColor(preset, rng.range(0.5, 0.7));
  ctx.fill();
  ctx.strokeStyle = stainColor(preset, 0.65, 0.7);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.save();
  roundRectPath(ctx, -L, -W, length, width, W * 0.5);
  ctx.clip();
  ctx.strokeStyle = stainColor(preset, 0.6, 0.6);
  ctx.lineWidth = 0.9;
  if (pattern === 'reticulate') {
    const grid = rng.range(5, 9);
    for (let gx = -L; gx <= L; gx += length / grid) {
      ctx.beginPath();
      ctx.moveTo(gx, -W);
      ctx.lineTo(gx + rng.range(-2, 2), W);
      ctx.stroke();
    }
    for (let gy = -W; gy <= W; gy += width / 3) {
      ctx.beginPath();
      ctx.moveTo(-L, gy);
      ctx.lineTo(L, gy + rng.range(-1.5, 1.5));
      ctx.stroke();
    }
  } else if (pattern === 'spiral') {
    ctx.beginPath();
    const turns = length / rng.range(9, 14);
    for (let t = 0; t <= turns * Math.PI * 2; t += 0.2) {
      const px = -L + (t / (turns * Math.PI * 2)) * length;
      const py = Math.sin(t) * W * 0.8;
      t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  } else if (pattern === 'annular') {
    for (let px = -L + width * 0.6; px < L; px += rng.range(7, 11)) {
      ctx.beginPath();
      ctx.ellipse(px, 0, width * 0.18, W * 0.95, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    // pitted / bordered_pitted：椭圆纹孔阵列
    const rows = pattern === 'bordered_pitted' ? 3 : 2;
    const cols = Math.max(3, Math.round((length * 0.5 * pitDensity) / 140));
    for (let ry = 0; ry < rows; ry++) {
      for (let c = 0; c < cols; c++) {
        const px = -L + ((c + 0.5) / cols) * length + rng.range(-1.5, 1.5);
        const py = -W + ((ry + 0.5) / rows) * width;
        ctx.beginPath();
        ctx.ellipse(px, py, pattern === 'bordered_pitted' ? 2.4 : 1.7, pattern === 'bordered_pitted' ? 1.8 : 1.2, 0, 0, Math.PI * 2);
        ctx.strokeStyle = stainColor(preset, 0.65, 0.55);
        ctx.stroke();
        if (pattern === 'bordered_pitted') {
          ctx.beginPath();
          ctx.arc(px, py, 0.7, 0, Math.PI * 2);
          ctx.fillStyle = stainColor(preset, 0.7, 0.5);
          ctx.fill();
        }
      }
    }
  }
  ctx.restore();
  // 端壁
  ctx.beginPath();
  ctx.moveTo(-L, -W);
  ctx.lineTo(-L, W);
  ctx.moveTo(L, -W);
  ctx.lineTo(L, W);
  ctx.strokeStyle = stainColor(preset, 0.7, 0.65);
  ctx.stroke();
  ctx.restore();
}

/** 纤维：极细长纺锤形，壁厚腔窄 */
export function drawFiber(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  preset: StainPreset,
  x: number,
  y: number,
  length: number,
  width: number,
  angle: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const L = length / 2;
  const W = width / 2;
  ctx.beginPath();
  ctx.moveTo(-L, 0);
  ctx.quadraticCurveTo(0, -W, L, 0);
  ctx.quadraticCurveTo(0, W, -L, 0);
  ctx.closePath();
  ctx.fillStyle = stainColor(preset, rng.range(0.6, 0.8));
  ctx.fill();
  ctx.strokeStyle = stainColor(preset, 0.6, 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-L * 0.92, 0);
  ctx.quadraticCurveTo(0, -W * 0.28, L * 0.92, 0);
  ctx.quadraticCurveTo(0, W * 0.28, -L * 0.92, 0);
  ctx.closePath();
  ctx.fillStyle = stainColor(preset, 0.15, 1.3);
  ctx.fill();
  ctx.restore();
}

/** 晶纤维：纤维 + 沿线附着方晶 */
export function drawCrystalFiber(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  preset: StainPreset,
  x: number,
  y: number,
  length: number,
  width: number,
  angle: number,
): void {
  drawFiber(ctx, rng, preset, x, y, length, width, angle);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const n = rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    const px = rng.range(-length * 0.38, length * 0.38);
    const py = (i % 2 === 0 ? 1 : -1) * width * 0.7;
    drawPrism(ctx, rng, preset, px, py, rng.range(2.5, 4.5));
  }
  ctx.restore();
}

/** 淀粉粒：类圆球，脐点/裂缝 */
export function drawStarch(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  preset: StainPreset,
  x: number,
  y: number,
  r: number,
  cleft: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * rng.range(0.9, 1.1), r * rng.range(0.85, 1.05), rng.range(0, 3), 0, Math.PI * 2);
  ctx.fillStyle = stainColor(preset, rng.range(0.5, 0.7), 1.15);
  ctx.fill();
  ctx.strokeStyle = stainColor(preset, 0.4, 0.8);
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // 脐点
  ctx.beginPath();
  if (cleft) {
    const a = rng.range(0, Math.PI);
    ctx.moveTo(Math.cos(a) * -r * 0.45, Math.sin(a) * -r * 0.45);
    ctx.lineTo(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45);
    ctx.strokeStyle = stainColor(preset, 0.7, 0.5);
    ctx.lineWidth = 0.9;
  } else {
    ctx.arc(0, 0, Math.max(0.8, r * 0.14), 0, Math.PI * 2);
    ctx.fillStyle = stainColor(preset, 0.65, 0.5);
  }
  cleft ? ctx.stroke() : ctx.fill();
  // 层纹
  if (r > 5) {
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.62, r * 0.58, 0, 0, Math.PI * 2);
    ctx.strokeStyle = stainColor(preset, 0.2, 0.8);
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  ctx.restore();
}

/** 花粉粒：圆球带刺状雕纹 */
export function drawPollen(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  preset: StainPreset,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = stainColor(preset, rng.range(0.55, 0.75));
  ctx.fill();
  ctx.strokeStyle = stainColor(preset, 0.55, 0.7);
  ctx.stroke();
  const spikes = rng.int(14, 22);
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + rng.range(-0.06, 0.06);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
    ctx.lineTo(Math.cos(a) * r * 1.28, Math.sin(a) * r * 1.28);
    ctx.strokeStyle = stainColor(preset, 0.6, 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // 萌发沟
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.12, r * 0.3, a, 0, Math.PI * 2);
    ctx.strokeStyle = stainColor(preset, 0.4, 0.6);
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  ctx.restore();
}

/** 气泡：亮而空的圆环，强边缘、无内部纹理 */
export function drawBubble(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
  ctx.lineWidth = rng.range(1.2, 2.2);
  ctx.strokeStyle = 'rgba(70,60,50,0.5)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.3, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fill();
  ctx.restore();
}

/** 不规则碎片（干扰） */
export function drawDebris(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  preset: StainPreset,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rng.range(0, Math.PI * 2));
  ctx.beginPath();
  const n = rng.int(5, 9);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * rng.range(0.4, 1);
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = stainColor(preset, rng.range(0.12, 0.28));
  ctx.fill();
  ctx.restore();
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function addSensorNoise(
  ctx: CanvasRenderingContext2D,
  size: number,
  rng: Rng,
  level: number,
): void {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * 255 * level;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

export type DrawKind = StructureType;
