import { detectImage } from '../core/detectionService';
import { evaluateBatch, type EvalReport, type ImageEvalInput } from '../core/evaluation';
import { ADULTERANT_ALIAS, ADULTERATION_PAIRS, DRUG_MAP } from '../core/knowledgeBase';
import type { DetectedObject, GroundTruthObject } from '../core/types';
import { GpuEngine } from '../gpu/GpuEngine';
import { generateSyntheticImage, WORK_SIZE } from '../synthetic/syntheticGenerator';
import { STAIN_PRESETS } from '../synthetic/primitives';
import { Rng } from '../core/mathUtils';

export interface BatchProgress {
  done: number;
  total: number;
  message: string;
}

/** 生成并跑完整个评测批次，返回指标报告 */
export async function runEvaluation(
  engine: GpuEngine,
  imageCount: number,
  baseSeed: number,
  onProgress?: (p: BatchProgress) => void,
): Promise<{ report: EvalReport; inputs: ImageEvalInput[] }> {
  const inputs: ImageEvalInput[] = [];
  const rng = new Rng(baseSeed ^ 0x9e3779b9);
  const drugIds = Object.keys(DRUG_MAP);
  const t0 = performance.now();
  for (let i = 0; i < imageCount; i++) {
    const isMixture = i % 3 === 2; // 1/3 批次为掺伪样品
    let sample;
    if (isMixture) {
      const pair = ADULTERATION_PAIRS[i % ADULTERATION_PAIRS.length];
      const aliasB = ADULTERANT_ALIAS[pair[1]] ?? pair[1];
      sample = generateSyntheticImage({
        drugs: [DRUG_MAP[pair[0]], DRUG_MAP[aliasB]],
        seed: baseSeed + i * 101,
        stain: STAIN_PRESETS[i % STAIN_PRESETS.length],
      });
    } else {
      const drugId = drugIds[i % drugIds.length];
      sample = generateSyntheticImage({
        drugs: [DRUG_MAP[drugId]],
        seed: baseSeed + i * 101,
        stain: STAIN_PRESETS[i % STAIN_PRESETS.length],
      });
    }
    const report = detectImage(engine, sample.canvas, { scaleUmPerPx: sample.scaleUmPerPx });
    const detected = report.result.objects.filter((o) => !o.hidden);
    const actualIds = sample.drugs;
    inputs.push({
      gt: sample.groundTruth as GroundTruthObject[],
      detected: detected as DetectedObject[],
      actualDrugIds: actualIds,
      rankedDrugIds: report.matches.map((m) => m.drugId),
      isMixture,
      mixtureDetected: report.mixture.detected,
      timingMs: report.result.timingMs,
    });
    onProgress?.({
      done: i + 1,
      total: imageCount,
      message: `已完成 ${i + 1}/${imageCount} 张（${isMixture ? '掺伪' : '单味'} · ${sample.stainPreset}）`,
    });
    await new Promise((r) => setTimeout(r, 0)); // 让出主线程更新 UI
  }
  void t0;
  void rng;
  void WORK_SIZE;
  const report = evaluateBatch(inputs);
  return { report, inputs };
}
