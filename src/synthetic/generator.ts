/**
 * 合成显微图生成器(Canvas2D)。
 * 按药典文字形态参数化绘制七类结构,并注入真实显微制片中的干扰:
 * 气泡(亮圆环)、结构重叠、染色深浅/色调漂移、组织碎屑、离焦模糊、噪点。
 * 每张图同时输出 ground-truth 标注,用于自动评测识别准确率。
 */
import type { StructureType, VesselKind } from '../types';

export interface GtObject {
  type: StructureType;
  cx: number;
  cy: number;
  bbox: { x: number; y: number; w: number; h: number };
  /** 生成参数,用于细粒度属性评测 */
  params: Record<string, number | string>;
}

export interface SyntheticImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  groundTruth: GtObject[];
  /** 染色参数(模拟换检验员导致的颜色漂移) */
  stain: { hue: number; saturation: number; brightness: number };
}

export interface GenOptions {
  width?: number;
  height?: number;
  /** 染色色调漂移 deg */
  stainHue?: number;
  stainSaturation?: number;
  stainBrightness?: number;
  /** 气泡数量 */
  bubbles?: number;
  /** 组织碎屑数量 */
  debris?: number;
  noise?: number;
  blur?: number;
  seed?: number;
}

/** 可复现随机数(mulberry32)。 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rand(r: () => number, min: number, max: number) {
  return min + r() * (max - min);
}

type Ctx = CanvasRenderingContext2D;

function bboxOf(cx: number, cy: number, rx: number, ry: number) {
  return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
}

/** 草酸钙簇晶:放射状多角晶束,sharpness 控制棱角尖钝。 */
function drawCluster(ctx: Ctx, r: () => number, cx: number, cy: number, size: number,
  sharpness: number): GtObject['params'] {
  const spikes = Math.round(rand(r, 9, 18));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rand(r, 0, Math.PI));
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const ang = (i / (spikes * 2)) * Math.PI * 2;
    const isTip = i % 2 === 0;
    // 钝棱角:半径差缩小;尖棱角:半径差拉大
    const tipR = size * rand(r, 0.85, 1.1);
    const valleyR = size * (isTip ? tipR : rand(r, 0.35, 0.65) * (1.15 - 0.55 * sharpness));
    const rr = isTip ? tipR : valleyR;
    const x = Math.cos(ang) * rr;
    const y = Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else {
      // 尖棱角用直线连接,钝棱角加圆角
      if (sharpness > 0.6) ctx.lineTo(x, y);
      else ctx.quadraticCurveTo(Math.cos(ang - 0.08) * rr * 1.05, Math.sin(ang - 0.08) * rr * 1.05, x, y);
    }
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(0, 0, size * 0.1, 0, 0, size);
  g.addColorStop(0, 'rgba(255,255,250,0.95)');
  g.addColorStop(1, 'rgba(225,228,235,0.85)');
  ctx.fillStyle = g;
  ctx.strokeStyle = 'rgba(120,125,140,0.7)';
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.fill();
  ctx.stroke();
  // 内部放射裂纹
  ctx.strokeStyle = 'rgba(140,145,160,0.55)';
  ctx.lineWidth = Math.max(0.6, size * 0.02);
  for (let i = 0; i < spikes; i++) {
    const ang = (i / spikes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(ang) * size * 0.8, Math.sin(ang) * size * 0.8);
    ctx.stroke();
  }
  ctx.restore();
  return { sharpness: round(sharpness), spikes };
}

/** 针晶束:一束纤细平行/略发散的亮针。 */
function drawNeedles(ctx: Ctx, r: () => number, cx: number, cy: number, len: number): GtObject['params'] {
  const n = Math.round(rand(r, 6, 14));
  const angle = rand(r, 0, Math.PI);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = 'rgba(240,244,250,0.9)';
  for (let i = 0; i < n; i++) {
    const off = rand(r, -len * 0.12, len * 0.12);
    const l = len * rand(r, 0.7, 1.1);
    ctx.lineWidth = rand(r, 0.8, 1.8);
    ctx.beginPath();
    ctx.moveTo(-l / 2, off);
    ctx.lineTo(l / 2, off + rand(r, -3, 3));
    ctx.stroke();
  }
  ctx.restore();
  return { needles: n, angle: round(angle) };
}

/** 石细胞:厚壁不规则多边形,纹孔为壁上暗点,pitDensity 控制疏密。 */
function drawStone(ctx: Ctx, r: () => number, cx: number, cy: number, size: number,
  pitDensity: number, branched: boolean): GtObject['params'] {
  const sides = Math.round(rand(r, 7, 11));
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const ang = (i / sides) * Math.PI * 2;
    let rr = size * rand(r, 0.75, 1.05);
    if (branched && i % 3 === 0) rr *= rand(r, 1.15, 1.4); // 分枝状
    pts.push({ x: cx + Math.cos(ang) * rr, y: cy + Math.sin(ang) * rr });
  }
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = 'rgba(190,165,120,0.55)';
  ctx.fill();
  // 厚壁:双层描边
  ctx.strokeStyle = 'rgba(90,70,40,0.85)';
  ctx.lineWidth = size * 0.22;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(60,45,25,0.9)';
  ctx.lineWidth = size * 0.06;
  ctx.stroke();
  // 胞腔
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(235,225,205,0.8)';
  ctx.fill();
  // 纹孔:沿内壁分布的暗点
  const pitCount = Math.round(pitDensity * 40);
  ctx.fillStyle = 'rgba(40,30,15,0.9)';
  for (let i = 0; i < pitCount; i++) {
    const ang = rand(r, 0, Math.PI * 2);
    const rr = size * rand(r, 0.55, 0.85);
    const px = cx + Math.cos(ang) * rr;
    const py = cy + Math.sin(ang) * rr;
    ctx.beginPath();
    ctx.arc(px, py, rand(r, 1.2, 2.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return { pitDensity: round(pitDensity), branched: branched ? 1 : 0 };
}

/** 导管:长管状,按纹式绘制内部纹理。 */
function drawVessel(ctx: Ctx, r: () => number, cx: number, cy: number,
  length: number, width: number, kind: VesselKind): GtObject['params'] {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rand(r, -0.12, 0.12));
  // 管壁
  ctx.fillStyle = 'rgba(170,140,95,0.5)';
  ctx.strokeStyle = 'rgba(80,60,35,0.85)';
  ctx.lineWidth = Math.max(1.5, width * 0.12);
  ctx.beginPath();
  ctx.rect(-length / 2, -width / 2, length, width);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(70,52,30,0.8)';
  ctx.lineWidth = 1;
  if (kind === 'spiral') {
    ctx.beginPath();
    const turns = length / (width * 0.9);
    for (let x = -length / 2; x <= length / 2; x += 2) {
      const y = Math.sin((x + length / 2) / length * turns * Math.PI * 2) * width * 0.32;
      x === -length / 2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (kind === 'annular') {
    for (let x = -length / 2 + width * 0.6; x < length / 2; x += width * 0.9) {
      ctx.beginPath();
      ctx.moveTo(x, -width * 0.42);
      ctx.lineTo(x, width * 0.42);
      ctx.stroke();
    }
  } else if (kind === 'reticulate') {
    for (let x = -length / 2; x < length / 2; x += width * 0.45) {
      ctx.beginPath();
      ctx.moveTo(x, -width * 0.4);
      ctx.lineTo(x + width * 0.45, width * 0.4);
      ctx.moveTo(x, width * 0.4);
      ctx.lineTo(x + width * 0.45, -width * 0.4);
      ctx.stroke();
    }
  } else if (kind === 'pitted' || kind === 'bordered_pit') {
    const rad = kind === 'bordered_pit' ? width * 0.13 : width * 0.08;
    ctx.fillStyle = 'rgba(50,38,22,0.85)';
    for (let x = -length / 2 + width * 0.4; x < length / 2 - width * 0.3; x += width * 0.42) {
      for (const yy of [-width * 0.22, width * 0.22]) {
        ctx.beginPath();
        ctx.arc(x + rand(r, -2, 2), yy + rand(r, -1.5, 1.5), rad, 0, Math.PI * 2);
        ctx.fill();
        if (kind === 'bordered_pit') {
          ctx.strokeStyle = 'rgba(90,70,45,0.7)';
          ctx.beginPath();
          ctx.arc(x, yy, rad * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
  return { kind, length: round(length), width: round(width) };
}

/** 纤维:长梭形厚壁,腔窄。 */
function drawFiber(ctx: Ctx, r: () => number, cx: number, cy: number,
  length: number, width: number): GtObject['params'] {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rand(r, -0.1, 0.1));
  ctx.beginPath();
  ctx.moveTo(-length / 2, 0);
  ctx.quadraticCurveTo(0, -width / 2, length / 2, 0);
  ctx.quadraticCurveTo(0, width / 2, -length / 2, 0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(185,155,105,0.5)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(85,65,38,0.85)';
  ctx.lineWidth = width * 0.28;
  ctx.stroke();
  // 窄腔
  ctx.strokeStyle = 'rgba(235,225,205,0.85)';
  ctx.lineWidth = Math.max(0.8, width * 0.08);
  ctx.beginPath();
  ctx.moveTo(-length * 0.42, 0);
  ctx.lineTo(length * 0.42, 0);
  ctx.stroke();
  ctx.restore();
  return { length: round(length), width: round(width) };
}

/** 淀粉粒:近圆光滑小粒,带脐点。 */
function drawStarch(ctx: Ctx, r: () => number, cx: number, cy: number, size: number): GtObject['params'] {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * rand(r, 0.9, 1.1), size * rand(r, 0.85, 1.05), rand(r, 0, Math.PI), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(225,210,180,0.75)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,120,85,0.5)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = 'rgba(90,75,50,0.8)';
  ctx.beginPath();
  ctx.arc(cx + size * 0.1, cy - size * 0.1, Math.max(0.7, size * 0.1), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return { size: round(size) };
}

/** 花粉粒:圆粒,表面刺/网纹,三萌发孔。 */
function drawPollen(ctx: Ctx, cx: number, cy: number, size: number,
  spiny: boolean): GtObject['params'] {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(215,190,130,0.8)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(110,85,45,0.7)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  if (spiny) {
    const n = 18;
    ctx.strokeStyle = 'rgba(110,85,45,0.8)';
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * size, Math.sin(ang) * size);
      ctx.lineTo(Math.cos(ang) * (size + size * 0.18), Math.sin(ang) * (size + size * 0.18));
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = 'rgba(110,85,45,0.55)';
    for (let i = -2; i <= 2; i++) {
      const rr = size * (0.3 + i * 0.18);
      if (rr <= 0.5) continue;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // 三萌发孔
  ctx.fillStyle = 'rgba(80,60,30,0.9)';
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(ang) * size * 0.6, Math.sin(ang) * size * 0.6, Math.max(0.8, size * 0.1), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return { size: round(size), spiny: spiny ? 1 : 0 };
}

/** 气泡:亮圆 + 深色边缘环,不输出 GT(纯干扰物)。 */
function drawBubble(ctx: Ctx, cx: number, cy: number, rad: number) {
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, rad * 0.3, cx, cy, rad);
  g.addColorStop(0, 'rgba(255,255,255,0.15)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(60,70,90,0.55)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,50,70,0.6)';
  ctx.lineWidth = Math.max(1, rad * 0.06);
  ctx.stroke();
  ctx.restore();
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

export interface ObjectSpec {
  type: StructureType;
  /** 出现概率 0..1(单味药场景按配方分布抽取) */
  weight: number;
  draw: (ctx: Ctx, r: () => number, cx: number, cy: number) => { w: number; h: number; params: GtObject['params'] };
}

/** 按药材配方生成对象规格(细参数与 herbs.ts 的定性描述对应)。 */
export function herbObjectSpecs(herbId: string, _r: () => number): ObjectSpec[] {
  const cluster = (sharpMin: number, sharpMax: number, sMin: number, sMax: number): ObjectSpec => ({
    type: 'calcium_cluster', weight: 3,
    draw: (ctx, rr, cx, cy) => {
      const size = rand(rr, sMin, sMax);
      const sharp = rand(rr, sharpMin, sharpMax);
      const params = drawCluster(ctx, rr, cx, cy, size, sharp);
      return { w: size * 2.4, h: size * 2.4, params };
    },
  });
  const stone = (pitMin: number, pitMax: number, branched: boolean): ObjectSpec => ({
    type: 'stone_cell', weight: 3,
    draw: (ctx, rr, cx, cy) => {
      const size = rand(rr, 22, 42);
      const pit = rand(rr, pitMin, pitMax);
      const params = drawStone(ctx, rr, cx, cy, size, pit, branched);
      return { w: size * 3, h: size * 3, params };
    },
  });
  const vessel = (kinds: VesselKind[]): ObjectSpec => ({
    type: 'vessel', weight: 2,
    draw: (ctx, rr, cx, cy) => {
      const kind = kinds[Math.floor(rr() * kinds.length)];
      const length = rand(rr, 110, 220);
      const width = rand(rr, 18, 34);
      const params = drawVessel(ctx, rr, cx, cy, length, width, kind);
      return { w: length + 10, h: width + 12, params };
    },
  });
  const fiber: ObjectSpec = {
    type: 'fiber', weight: 3,
    draw: (ctx, rr, cx, cy) => {
      const length = rand(rr, 130, 260);
      const width = rand(rr, 12, 22);
      const params = drawFiber(ctx, rr, cx, cy, length, width);
      return { w: length + 8, h: width + 8, params };
    },
  };
  const starch: ObjectSpec = {
    type: 'starch', weight: 2,
    draw: (ctx, rr, cx, cy) => {
      const size = rand(rr, 4, 11);
      const params = drawStarch(ctx, rr, cx, cy, size);
      return { w: size * 2.5, h: size * 2.5, params };
    },
  };
  const pollen = (spiny: boolean): ObjectSpec => ({
    type: 'pollen', weight: 3,
    draw: (ctx, rr, cx, cy) => {
      const size = rand(rr, 12, 22);
      const params = drawPollen(ctx, cx, cy, size, spiny);
      return { w: size * 2.6, h: size * 2.6, params };
    },
  });
  const needles: ObjectSpec = {
    type: 'calcium_needle', weight: 4,
    draw: (ctx, rr, cx, cy) => {
      const len = rand(rr, 60, 110);
      const params = drawNeedles(ctx, rr, cx, cy, len);
      return { w: len + 10, h: len * 0.35, params };
    },
  };

  const recipes: Record<string, ObjectSpec[]> = {
    dahuang: [cluster(0.2, 0.55, 28, 55), vessel(['reticulate', 'annular']), starch],
    renshen: [cluster(0.6, 0.95, 16, 32), vessel(['reticulate', 'spiral']), starch],
    gancao: [fiber, vessel(['bordered_pit', 'reticulate']), cluster(0.4, 0.8, 12, 22), starch],
    huanglian: [stone(0.2, 0.6, false), fiber, starch],
    huangbo: [fiber, stone(0.1, 0.45, true), cluster(0.4, 0.8, 10, 20)],
    houpo: [stone(0.2, 0.55, true), fiber, vessel(['reticulate', 'bordered_pit'])],
    rougui: [fiber, stone(0.5, 1.0, false), starch],
    dingxiang: [cluster(0.55, 0.95, 10, 20), pollen(true), fiber],
    jinyinhua: [pollen(true), cluster(0.5, 0.9, 8, 16), vessel(['spiral', 'reticulate'])],
    banxia: [needles, starch, vessel(['spiral', 'annular'])],
    puhuang: [pollen(false), starch],
  };
  return recipes[herbId] ?? recipes.dahuang;
}

/** 生成一张合成显微图。objects 可显式指定(掺伪场景混排两套配方)。 */
export function generateImage(
  opts: GenOptions & { specs?: ObjectSpec[]; objectCount?: [number, number] } = {},
): SyntheticImage {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 960;
  const r = rng(opts.seed ?? 1);
  const stain = {
    hue: opts.stainHue ?? rand(r, -25, 25),
    saturation: opts.stainSaturation ?? rand(r, 0.4, 1),
    brightness: opts.stainBrightness ?? rand(r, 0.75, 1.15),
  };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 背景:暖灰组织底色 + 缓慢明暗梯度
  const bg = ctx.createLinearGradient(0, 0, width, height);
  const base = 205 * stain.brightness;
  bg.addColorStop(0, `rgb(${base + 12},${base + 2},${base - 12})`);
  bg.addColorStop(1, `rgb(${base - 8},${base - 14},${base - 22})`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 组织碎屑:随机半透明多边形
  const debris = opts.debris ?? 40;
  for (let i = 0; i < debris; i++) {
    const cx = rand(r, 0, width);
    const cy = rand(r, 0, height);
    const rad = rand(r, 6, 26);
    ctx.beginPath();
    const n = Math.round(rand(r, 4, 7));
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2;
      const rr = rad * rand(r, 0.5, 1);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(150,125,90,${rand(r, 0.03, 0.08)})`;
    ctx.fill();
  }

  const specs = opts.specs ?? herbObjectSpecs('dahuang', r);
  const totalWeight = specs.reduce((a, s) => a + s.weight, 0);
  const [minN, maxN] = opts.objectCount ?? [14, 22];
  const count = Math.round(rand(r, minN, maxN));
  const groundTruth: GtObject[] = [];
  const placed: { x: number; y: number; w: number; h: number }[] = [];

  for (let i = 0; i < count; i++) {
    let pick = r() * totalWeight;
    let spec = specs[0];
    for (const s of specs) {
      pick -= s.weight;
      if (pick <= 0) {
        spec = s;
        break;
      }
    }
    // 允许约 25% 重叠(真实制片中结构互相挤压)
    let cx = 0;
    let cy = 0;
    let attempts = 0;
    do {
      cx = rand(r, 60, width - 60);
      cy = rand(r, 60, height - 60);
      attempts++;
    } while (attempts < 20 && placed.some((p) =>
      Math.abs(p.x - cx) < (p.w / 2 + 30) && Math.abs(p.y - cy) < (p.h / 2 + 30) && r() > 0.25));

    const result = spec.draw(ctx, r, cx, cy);
    placed.push({ x: cx, y: cy, w: result.w, h: result.h });
    groundTruth.push({
      type: spec.type,
      cx,
      cy,
      bbox: bboxOf(cx, cy, result.w / 2, result.h / 2),
      params: result.params,
    });
  }

  // 气泡(干扰,无 GT)
  const bubbles = opts.bubbles ?? 5;
  for (let i = 0; i < bubbles; i++) {
    drawBubble(ctx, rand(r, 40, width - 40), rand(r, 40, height - 40), rand(r, 10, 34));
  }

  // 染色色调/深浅漂移:整屏叠色
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `hsla(${30 + stain.hue}, ${45 * stain.saturation}%, ${70 + stain.brightness * 12}%, 0.28)`;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';

  // 噪点
  const noise = opts.noise ?? 6;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * noise;
    d[i] = clamp(d[i] + n);
    d[i + 1] = clamp(d[i + 1] + n);
    d[i + 2] = clamp(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);

  // 离焦模糊(轻微)
  if (opts.blur && opts.blur > 0) {
    ctx.filter = `blur(${opts.blur}px)`;
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
  }

  return { canvas, width, height, groundTruth, stain };
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** 掺伪样品:主药 70% + 次药 30% 的结构混排在同一张图。 */
export function generateAdulteratedImage(
  primaryHerb: string,
  secondaryHerb: string,
  opts: GenOptions & { seed?: number } = {},
): SyntheticImage {
  const r = rng((opts.seed ?? 99) >>> 0);
  const a = herbObjectSpecs(primaryHerb, r);
  const b = herbObjectSpecs(secondaryHerb, r);
  const specs: ObjectSpec[] = [
    ...a.map((s) => ({ ...s, weight: s.weight * 0.7 })),
    ...b.map((s) => ({ ...s, weight: s.weight * 0.3 })),
  ];
  return generateImage({ ...opts, specs, seed: opts.seed });
}
