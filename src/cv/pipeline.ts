/**
 * 单图/多样品分析编排:GPU 管线 → 连通域 → 特征分类 → 标注与统计。
 */
import type { Annotation, ImageAnalysis, RegionFeatures, StructureType } from '../types';
import { GpuPipeline } from '../gpu/GpuPipeline';
import { extractFeatures, countByType } from './segmentation';

let sharedPipeline: GpuPipeline | null = null;

export function getPipeline(): GpuPipeline {
  if (!sharedPipeline) sharedPipeline = new GpuPipeline();
  return sharedPipeline;
}

export function regionsToAnnotations(regions: RegionFeatures[]): Annotation[] {
  return regions
    .filter((r) => r.type !== 'unknown')
    .map((r, i) => ({
      id: `auto-${i}-${Math.round(r.cx)}-${Math.round(r.cy)}`,
      type: r.type as StructureType,
      cx: r.cx,
      cy: r.cy,
      bbox: r.bbox,
      source: 'auto' as const,
      confidence: r.confidence,
    }));
}

export function analyzeImage(
  image: ImageBitmap | ImageData | HTMLImageElement,
  imageId: string,
  thresholdC = 0.08,
): ImageAnalysis {
  const pipeline = getPipeline();
  const out = pipeline.process(image, thresholdC);
  const regions = extractFeatures(out.pixels, out.width, out.height);
  const annotations = regionsToAnnotations(regions);
  const counts = countByType(regions);
  const sizeStats: ImageAnalysis['sizeStats'] = {};
  const grouped = new Map<StructureType, number[]>();
  for (const r of regions) {
    if (r.type === 'unknown') continue;
    const arr = grouped.get(r.type) ?? [];
    arr.push(r.equivDiameter);
    grouped.set(r.type, arr);
  }
  for (const [t, ds] of grouped) {
    sizeStats[t] = {
      mean: ds.reduce((a, b) => a + b, 0) / ds.length,
      min: Math.min(...ds),
      max: Math.max(...ds),
      n: ds.length,
    };
  }
  return {
    imageId,
    width: out.width,
    height: out.height,
    regions,
    annotations,
    counts,
    sizeStats,
    timings: out.timings,
  };
}
