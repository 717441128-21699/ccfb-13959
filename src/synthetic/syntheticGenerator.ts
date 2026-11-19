import type {
  BBox,
  DrugProfile,
  GroundTruthObject,
  StructureType,
  SyntheticSample,
  TraitName,
  VesselPattern,
} from '../core/types';
import { Rng, clamp } from '../core/mathUtils';
import {
  STAIN_PRESETS,
  StainPreset,
  addSensorNoise,
  drawBackground,
  drawBubble,
  drawClusterCrystal,
  drawCrystalFiber,
  drawDebris,
  drawFiber,
  drawPollen,
  drawPrism,
  drawStarch,
  drawStoneCell,
  drawVessel,
} from './primitives';

export const WORK_SIZE = 1024;
export const SCALE_UM_PER_PX = 0.5;

interface Placement {
  x: number;
  y: number;
  r: number;
}

function sampleTrait(
  rng: Rng,
  traits: Partial<Record<TraitName, { lo: number; hi: number; tol?: number }>> | undefined,
  name: TraitName,
  fallback: number,
  spread = 0.12,
): number {
  const t = traits?.[name];
  if (!t) return fallback;
  const mid = (t.lo + t.hi) / 2;
  const sd = (t.hi - t.lo) * spread + 0.01;
  return rng.gaussianClamped(mid, sd, t.lo - (t.tol ?? 0), t.hi + (t.tol ?? 0));
}

function nonOverlappingPlace(
  rng: Rng,
  existing: Placement[],
  radius: number,
  size: number,
  forceOverlap: boolean,
): Placement {
  if (forceOverlap && existing.length > 2) {
    const anchor = rng.pick(existing);
    const off = radius * rng.range(0.2, 0.9);
    const a = rng.range(0, Math.PI * 2);
    return {
      x: clamp(anchor.x + Math.cos(a) * off, radius + 4, size - radius - 4),
      y: clamp(anchor.y + Math.sin(a) * off, radius + 4, size - radius - 4),
      r: radius,
    };
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const p = {
      x: rng.range(radius + 10, size - radius - 10),
      y: rng.range(radius + 10, size - radius - 10),
      r: radius,
    };
    if (existing.every((e) => Math.hypot(e.x - p.x, e.y - p.y) > (e.r + p.r) * 0.92)) return p;
  }
  return { x: rng.range(40, size - 40), y: rng.range(40, size - 40), r: radius };
}

export interface GenerateOptions {
  drugs: DrugProfile[];
  seed: number;
  stain?: StainPreset;
  bubbleCount?: number;
  noiseLevel?: number;
  overlapPairs?: number;
}

/** 生成一张带金标准的合成显微照片 */
export function generateSyntheticImage(opts: GenerateOptions): SyntheticSample {
  const rng = new Rng(opts.seed);
  const size = WORK_SIZE;
  const stain = opts.stain ?? rng.pick(STAIN_PRESETS);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  drawBackground(ctx, size, rng, stain);

  const groundTruth: GroundTruthObject[] = [];
  const placements: Placement[] = [];
  let overlapBudget = opts.overlapPairs ?? rng.int(2, 4);

  const record = (
    type: StructureType,
    p: Placement,
    subtype: VesselPattern | undefined,
    traits: Partial<Record<TraitName, number>>,
  ): void => {
    const bbox: BBox = {
      x: Math.round(p.x - p.r),
      y: Math.round(p.y - p.r),
      w: Math.round(p.r * 2),
      h: Math.round(p.r * 2),
    };
    groundTruth.push({ type, subtype, x: p.x, y: p.y, radius: p.r, bbox, traits });
  };

  for (const profile of opts.drugs) {
    for (const exp of profile.structures) {
      // 单视野按丰度级别折算实际个数
      const count = Math.max(1, Math.round(exp.abundance * rng.range(0.55, 1.05)));
      for (let k = 0; k < count; k++) {
        const forceOverlap = overlapBudget > 0 && rng.bool(0.18);
        if (forceOverlap) overlapBudget--;
        switch (exp.type) {
          case 'cluster_crystal': {
            const diam = sampleTrait(rng, exp.traits, 'diameter', 40);
            const tipAngle = sampleTrait(rng, exp.traits, 'tipAngle', 40, 0.16);
            const tipCount = Math.round(sampleTrait(rng, exp.traits, 'tipCount', 10, 0.1));
            const radiusPx = (diam / 2 / SCALE_UM_PER_PX) * rng.range(0.9, 1.1);
            const p = nonOverlappingPlace(rng, placements, radiusPx, size, forceOverlap);
            placements.push(p);
            drawClusterCrystal(ctx, rng, stain, p.x, p.y, radiusPx, tipAngle, tipCount);
            record(exp.type, p, undefined, { diameter: diam, tipAngle, tipCount });
            break;
          }
          case 'prism_crystal': {
            const diam = sampleTrait(rng, exp.traits, 'diameter', 14);
            const r = (diam / 2 / SCALE_UM_PER_PX) * rng.range(0.9, 1.1);
            const p = nonOverlappingPlace(rng, placements, r, size, forceOverlap);
            placements.push(p);
            drawPrism(ctx, rng, stain, p.x, p.y, r);
            record(exp.type, p, undefined, { diameter: diam });
            break;
          }
          case 'stone_cell': {
            const diam = sampleTrait(rng, exp.traits, 'diameter', 40);
            const wallRatio = sampleTrait(rng, exp.traits, 'wallRatio', 0.45, 0.1);
            const pitDensity = sampleTrait(rng, exp.traits, 'pitDensity', 9, 0.12);
            const solidity = sampleTrait(rng, exp.traits, 'solidity', 0.7, 0.1);
            const branches = solidity < 0.66 ? rng.int(2, 4) : rng.int(0, 1);
            const r = (diam / 2 / SCALE_UM_PER_PX) * rng.range(0.92, 1.08);
            const p = nonOverlappingPlace(rng, placements, r * 1.3, size, forceOverlap);
            placements.push({ ...p, r });
            drawStoneCell(ctx, rng, stain, p.x, p.y, r, { wallRatio, pitDensity, branches, solidity });
            record(exp.type, p, undefined, { diameter: diam, wallRatio, pitDensity, solidity });
            break;
          }
          case 'vessel': {
            const diam = sampleTrait(rng, exp.traits, 'diameter', 40);
            const widthPx = (diam / SCALE_UM_PER_PX) * rng.range(0.9, 1.1);
            const lengthUm = rng.range(90, 260);
            const lengthPx = lengthUm / SCALE_UM_PER_PX;
            const pitDensity = exp.traits?.pitDensity
              ? sampleTrait(rng, exp.traits, 'pitDensity', 14)
              : rng.range(8, 18);
            const angle = rng.range(-0.5, 0.5) + (rng.bool(0.25) ? Math.PI / 2 : 0);
            const p = nonOverlappingPlace(rng, placements, Math.max(widthPx, lengthPx) / 2, size, forceOverlap);
            placements.push({ ...p, r: widthPx });
            drawVessel(ctx, rng, stain, p.x, p.y, lengthPx, widthPx, angle, exp.subtype ?? 'reticulate', pitDensity);
            record(exp.type, p, exp.subtype, { diameter: diam, length: lengthUm, pitDensity });
            break;
          }
          case 'fiber':
          case 'crystal_fiber': {
            const diam = sampleTrait(rng, exp.traits, 'diameter', 14);
            const ar = sampleTrait(rng, exp.traits, 'aspectRatio', 9, 0.12);
            const widthPx = (diam / SCALE_UM_PER_PX) * rng.range(0.9, 1.1);
            const lengthPx = widthPx * ar;
            const angle = rng.range(-0.4, 0.4) + (rng.bool(0.3) ? Math.PI / 2 : 0);
            const p = nonOverlappingPlace(rng, placements, Math.max(widthPx, lengthPx) / 2, size, forceOverlap);
            placements.push({ ...p, r: widthPx });
            if (exp.type === 'crystal_fiber') {
              drawCrystalFiber(ctx, rng, stain, p.x, p.y, lengthPx, widthPx, angle);
            } else {
              drawFiber(ctx, rng, stain, p.x, p.y, lengthPx, widthPx, angle);
            }
            record(exp.type, p, undefined, { diameter: diam, aspectRatio: ar, length: lengthPx * SCALE_UM_PER_PX });
            break;
          }
          case 'starch': {
            const diam = sampleTrait(rng, exp.traits, 'diameter', 8);
            const r = (diam / 2 / SCALE_UM_PER_PX) * rng.range(0.85, 1.15);
            const p = nonOverlappingPlace(rng, placements, r, size, forceOverlap);
            placements.push(p);
            const cleft = rng.bool(profile.id === 'banxia' ? 0.7 : 0.3);
            drawStarch(ctx, rng, stain, p.x, p.y, r, cleft);
            record(exp.type, p, undefined, { diameter: diam });
            break;
          }
          case 'pollen': {
            const diam = sampleTrait(rng, exp.traits, 'diameter', 50);
            const r = (diam / 2 / SCALE_UM_PER_PX) * rng.range(0.92, 1.08);
            const p = nonOverlappingPlace(rng, placements, r * 1.3, size, forceOverlap);
            placements.push({ ...p, r });
            drawPollen(ctx, rng, stain, p.x, p.y, r);
            record(exp.type, p, undefined, { diameter: diam });
            break;
          }
          default:
            break;
        }
      }
    }
  }

  // 气泡干扰
  const bubbleCount = opts.bubbleCount ?? rng.int(2, 5);
  for (let i = 0; i < bubbleCount; i++) {
    const r = rng.range(8, 34);
    const p = nonOverlappingPlace(rng, placements, r, size, false);
    drawBubble(ctx, rng, p.x, p.y, r);
  }
  // 碎片干扰
  for (let i = 0; i < rng.int(4, 9); i++) {
    const r = rng.range(4, 14);
    const p = nonOverlappingPlace(rng, placements, r, size, false);
    drawDebris(ctx, rng, stain, p.x, p.y, r);
  }
  addSensorNoise(ctx, size, rng, opts.noiseLevel ?? rng.range(0.02, 0.05));

  return {
    canvas,
    groundTruth,
    scaleUmPerPx: SCALE_UM_PER_PX,
    stainPreset: stain.id,
    drugs: opts.drugs.map((d) => d.id),
  };
}
