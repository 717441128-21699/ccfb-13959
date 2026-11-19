import { GpuEngine } from '../gpu/GpuEngine';
import { clamp, percentile } from './mathUtils';
import { buildWatershedMarkers, connectedComponents, fillHoles } from './cpuImaging';

export interface GpuIntermediate {
  engine: GpuEngine;
  normalized: Float32Array; // RGBA：g, sat, resid, 原始亮度
  edge: Float32Array; // r 通道
  variance: Float32Array; // r 通道
  mask: Uint8Array;
  distance: Float32Array;
  basinLabels: Int32Array;
  regionLabels: Int32Array;
  overlappedRegions: Set<number>;
}

export interface PipelineParams {
  workSize: number;
  blurRadius: number;
  globalThresh: number;
  edgeThresh: number;
  minAreaPx: number;
  minPeakDist: number;
}

export const DEFAULT_PARAMS: PipelineParams = {
  workSize: 1024,
  blurRadius: 3,
  globalThresh: 0.4,
  edgeThresh: 0.32,
  minAreaPx: 40,
  minPeakDist: 11,
};

/** 把输入画布等比缩放到工作分辨率（不足则居中铺底） */
export function drawToWorkCanvas(source: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = 'rgb(242,238,230)';
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / source.width, size / source.height);
  const w = source.width * scale;
  const h = source.height * scale;
  ctx.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
  return c;
}

function sampleChannelPercentiles(img: ImageData): {
  lo: [number, number, number];
  hi: [number, number, number];
} {
  const step = 16; // 抽样 1/256 像素
  const channels: number[][] = [[], [], []];
  for (let i = 0; i < img.data.length; i += 4 * step) {
    for (let c = 0; c < 3; c++) {
      channels[c].push(-Math.log(clamp(img.data[i + c] / 255, 0.004, 1)));
    }
  }
  const lo: [number, number, number] = [0, 0, 0];
  const hi: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    lo[c] = percentile(channels[c], 8);
    hi[c] = percentile(channels[c], 98);
  }
  return { lo, hi };
}

/**
 * 完整 GPU 前端流水线。返回中间数据供 CPU 测量/分类复用。
 * 除连通域与分水岭种子外，全部像素级计算都在片元着色器内完成。
 */
export function runGpuPipeline(
  engine: GpuEngine,
  source: HTMLCanvasElement,
  params: PipelineParams = DEFAULT_PARAMS,
): { inter: GpuIntermediate; gpuMs: number; cpuMs: number } {
  const t0 = performance.now();
  const size = params.workSize;
  const work = drawToWorkCanvas(source, size);
  const ctx = work.getContext('2d', { willReadFrequently: true })!;
  const imageData = ctx.getImageData(0, 0, size, size);
  const { lo, hi } = sampleChannelPercentiles(imageData);

  const inputTex = engine.uploadImageData(imageData);
  // 1. 染色归一化（光密度 + 通道百分位拉伸 → 染色不变量）
  const norm = engine.normalize(inputTex, lo, hi);
  // 2. 降噪模糊（横纵两次）
  const blurH = engine.boxBlur(norm, 1, 0, params.blurRadius);
  const blur = engine.boxBlur(blurH, 0, 1, params.blurRadius);
  engine.release(blurH);
  // 3. 局部方差（纹理复杂度，供测量阶段使用）
  const sq = engine.square(blur);
  const b2h = engine.boxBlur(sq, 1, 0, 8);
  const b2 = engine.boxBlur(b2h, 0, 1, 8);
  engine.release(sq);
  engine.release(b2h);
  const b1h = engine.boxBlur(blur, 1, 0, 8);
  const b1 = engine.boxBlur(b1h, 0, 1, 8);
  engine.release(b1h);
  const varTex = engine.variance(b1, b2);
  // 4. Sobel 边缘
  const edge = engine.sobel(blur);
  // 5. 全局阈值分割（归一化双峰之间），强边缘补轮廓断裂；不依赖局部背景，大结构内部可成块
  let maskTex = engine.globalThreshold(blur, edge, params.globalThresh, params.edgeThresh);
  // 6. 形态学清理：两次开运算去碎块，再闭运算补内部断裂
  const er1 = engine.morph(maskTex, 0);
  const di1 = engine.morph(er1, 1);
  const er1b = engine.morph(di1, 0);
  const di1b = engine.morph(er1b, 1);
  const di2 = engine.morph(di1b, 1);
  const er2 = engine.morph(di2, 0);
  engine.release(maskTex);
  engine.release(er1);
  engine.release(di1);
  engine.release(er1b);
  engine.release(di1b);
  engine.release(di2);
  maskTex = er2;
  // 7. JFA 距离变换（GPU）
  const distTex = engine.jfaDistance(maskTex);

  // 回读供 CPU 后处理
  const normalized = engine.readFloat(norm);
  const edgeVals = engine.readChannel(edge, 0);
  const varVals = engine.readChannel(varTex, 0);
  let mask = engine.readMask(maskTex);
  const distance = engine.readChannel(distTex, 0);

  engine.release(norm);
  engine.release(blur);
  engine.release(b1);
  engine.release(b2);
  engine.release(varTex);
  engine.release(edge);
  engine.release(distTex);
  engine.release(maskTex);

  const tGpu = performance.now() - t0;
  const t1 = performance.now();

  // 8. 填洞：只补目标内部小孔（石细胞腔/气泡），严格面积上限防止大空心环被填满成巨块
  mask = fillHoles(mask, size, size, 150);
  // 9. 连通域
  const { labels, regions } = connectedComponents(mask, size, size, params.minAreaPx);
  // 10. 距离图上找峰 → 分水岭种子
  const { markers } = buildWatershedMarkers(distance, labels, regions, size, size, params.minPeakDist);
  const markerTex = engine.uploadMarkerTexture(markers);
  // 重新上传填洞后的 mask
  const filledTex = engine.uploadUint8Mask(mask);
  // 11. GPU JFA 分水岭传播
  const basinTex = engine.jfaWatershed(markerTex, filledTex);
  const basinFloat = engine.readFloat(basinTex);
  engine.release(basinTex);
  engine.release(markerTex);
  engine.release(filledTex);
  const basinLabels = new Int32Array(size * size);
  for (let i = 0; i < basinLabels.length; i++) basinLabels[i] = Math.round(basinFloat[i * 4]);

  // 12. 标记重叠：一个原始连通域内出现多个分水岭盆地
  const basinSetPerRegion = new Map<number, Set<number>>();
  for (let i = 0; i < labels.length; i++) {
    const r = labels[i];
    if (!r) continue;
    const b = basinLabels[i];
    let set = basinSetPerRegion.get(r);
    if (!set) {
      set = new Set();
      basinSetPerRegion.set(r, set);
    }
    if (b) set.add(b);
  }
  const overlappedRegions = new Set<number>();
  for (const [r, set] of basinSetPerRegion) if (set.size > 1) overlappedRegions.add(r);

  const tCpu = performance.now() - t1;
  return {
    inter: {
      engine,
      normalized,
      edge: edgeVals,
      variance: varVals,
      mask,
      distance,
      basinLabels,
      regionLabels: labels,
      overlappedRegions,
    },
    gpuMs: tGpu,
    cpuMs: tCpu,
  };
}
