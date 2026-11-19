import { classifyAll, recount } from './classifier';
import { DEFAULT_PARAMS, type PipelineParams, runGpuPipeline } from './gpuPipeline';
import { GpuEngine } from '../gpu/GpuEngine';
import { detectMixture, matchDrugs } from './matcher';
import { measureAllObjects } from './measurement';
import type { DetectedObject, DetectionResult, SampleReport } from './types';

export interface DetectOptions {
  scaleUmPerPx: number;
  params?: PipelineParams;
}

/** 在给定 WebGL 引擎上跑一张图：GPU 分割/分水岭 → CPU 测量 → 规则分类 → 药典匹配 */
export function detectImage(
  engine: GpuEngine,
  canvas: HTMLCanvasElement,
  opts: DetectOptions,
): SampleReport {
  const tStart = performance.now();
  const { inter, gpuMs, cpuMs: gpuCpuMs } = runGpuPipeline(
    engine,
    canvas,
    opts.params ?? DEFAULT_PARAMS,
  );
  const measured = measureAllObjects(inter, opts.scaleUmPerPx, DEFAULT_PARAMS.minAreaPx);
  const classified = classifyAll(measured);
  // 气泡与碎片不参与药材匹配但保留在图上（检验员可改）
  const objects = classified.filter((o) => {
    if (o.features.areaPx < DEFAULT_PARAMS.minAreaPx) return false;
    return true;
  });
  reindex(objects);
  const counts = recount(objects);
  const result: DetectionResult = {
    width: engine.width,
    height: engine.height,
    scaleUmPerPx: opts.scaleUmPerPx,
    objects,
    counts,
    timingMs: performance.now() - tStart,
    gpuMs,
    cpuMs: gpuCpuMs + (performance.now() - tStart - gpuMs - gpuCpuMs),
  };
  const matches = matchDrugs(objects);
  const mixture = detectMixture(objects, matches);
  return {
    imageName: '',
    result,
    matches,
    mixture,
  };
}

function reindex(objects: DetectedObject[]): void {
  objects.forEach((o, i) => (o.id = i + 1));
}
