import {
  convexHull,
  detectTips,
  momentsFromPixels,
  polygonArea,
  polygonPerimeter,
  radialSymmetry,
  simplifyPolygon,
  type Pt,
} from './geometry';
import { traceContour } from './cpuImaging';
import { clamp, mean } from './mathUtils';
import type {
  BBox,
  DetectedObject,
  MeasuredFeatures,
  VesselPattern,
} from './types';
import type { GpuIntermediate } from './gpuPipeline';

interface BasinData {
  id: number;
  pixels: Pt[];
  bbox: BBox;
  centroid: Pt;
}

/** 在目标内部统计暗斑候选（纹孔/孔沟）数量；全程单趟循环，避免大数组展开爆栈 */
function countDarkSpots(
  basin: BasinData,
  inter: GpuIntermediate,
): { spots: number; wallBand: number } {
  const size = inter.engine.width;
  const { pixels } = basin;
  // 第一趟：求最大距离
  let maxDist = 1;
  for (const p of pixels) {
    const d = inter.distance[p.y * size + p.x];
    if (d > maxDist) maxDist = d;
  }
  const wallLimit = maxDist * 0.45;
  // 位图标记壁带像素，避免大 Set
  const member = new Uint8Array(size * size);
  let wallCount = 0;
  let sum = 0;
  for (const p of pixels) {
    const idx = p.y * size + p.x;
    if (inter.distance[idx] < wallLimit) {
      member[idx] = 1;
      wallCount++;
      sum += inter.normalized[idx * 4];
    }
  }
  if (wallCount < 8) return { spots: 0, wallBand: 0 };
  const m = sum / wallCount;
  let varSum = 0;
  for (const p of pixels) {
    const idx = p.y * size + p.x;
    if (member[idx]) {
      const g = inter.normalized[idx * 4];
      varSum += (g - m) * (g - m);
    }
  }
  const sd = Math.sqrt(varSum / wallCount) || 0.02;
  const visited = new Uint8Array(size * size);
  const stack: number[] = [];
  let spots = 0;
  for (const seed of pixels) {
    const idx = seed.y * size + seed.x;
    if (!member[idx] || visited[idx]) continue;
    visited[idx] = 1;
    if (inter.normalized[idx * 4] < m - 0.9 * sd) {
      let sizeCount = 0;
      stack.length = 0;
      stack.push(idx);
      while (stack.length) {
        const cur = stack.pop()!;
        sizeCount++;
        const cx = cur % size;
        const cy = (cur / size) | 0;
        const nb = [
          cx > 0 ? cur - 1 : -1,
          cx < size - 1 ? cur + 1 : -1,
          cy > 0 ? cur - size : -1,
          cy < size - 1 ? cur + size : -1,
        ];
        for (const ni of nb) {
          if (ni < 0 || !member[ni] || visited[ni]) continue;
          if (inter.normalized[ni * 4] < m - 0.5 * sd) {
            visited[ni] = 1;
            stack.push(ni);
          }
        }
      }
      if (sizeCount >= 2 && sizeCount <= 40) spots++;
    }
  }
  return { spots, wallBand: wallCount };
}

/** 导管纹理：估计网纹/纹孔/螺纹/环纹的响应分 */
function vesselPatternScores(
  basin: BasinData,
  inter: GpuIntermediate,
): { scores: Record<VesselPattern, number>; ridgeDensity: number } {
  const size = inter.engine.width;
  const { pixels, centroid, bbox } = basin;
  const member = new Uint8Array(size * size);
  for (const p of pixels) member[p.y * size + p.x] = 1;
  // 内部边缘总能量与方向性：沿 4 个方向统计边缘投影
  let edgeSum = 0;
  let edgeCount = 0;
  let hProj = 0;
  let vProj = 0;
  let diagProj = 0;
  for (const p of pixels) {
    const i = p.y * size + p.x;
    const e = inter.edge[i];
    edgeSum += e;
    if (e > 0.12) {
      edgeCount++;
      const dx = p.x - centroid.x;
      const dy = p.y - centroid.y;
      const ang = Math.atan2(dy, dx);
      hProj += Math.abs(Math.cos(ang));
      vProj += Math.abs(Math.sin(ang));
      diagProj += Math.abs(Math.cos(ang - Math.PI / 4));
    }
  }
  const internalDensity = edgeCount / Math.max(pixels.length, 1);
  // 沿长轴截面数边缘穿越次数 → 脊线密度
  const longSide = Math.max(bbox.w, bbox.h);
  const angle = Math.atan2(bbox.h, bbox.w);
  let crossings = 0;
  const samples = Math.min(28, longSide);
  for (let s = 1; s < samples; s++) {
    const t = s / samples - 0.5;
    const px = Math.round(centroid.x + Math.cos(angle) * t * longSide);
    const py = Math.round(centroid.y + Math.sin(angle) * t * longSide);
    const i = py * size + px;
    if (member[i] && inter.edge[i] > 0.12) crossings++;
  }
  const ridgeDensity = (crossings / Math.max(longSide, 1)) * 100;
  const directional = edgeCount > 0 ? diagProj / edgeCount : 0;
  const ringness = edgeCount > 0 ? Math.max(hProj, vProj) / edgeCount : 0;

  const scores = {
    reticulate: clamp(internalDensity * 6 + (1 - Math.abs(directional - 0.55) * 2) * 0.4, 0, 2),
    pitted: clamp(internalDensity * 4 - directional * 0.6, 0, 2),
    bordered_pitted: clamp(internalDensity * 5 - directional * 0.8 + ringness * 0.3, 0, 2),
    spiral: clamp(directional * 1.4 + clamp(ridgeDensity / 22, 0, 1) * 0.8, 0, 2),
    annular: clamp(ringness * 1.2 + clamp(ridgeDensity / 14, 0, 1) * 0.6, 0, 2),
  };
  void edgeSum;
  return { scores, ridgeDensity };
}

/** 测量一个盆地目标的全部性状 */
export function measureBasin(
  basin: BasinData,
  inter: GpuIntermediate,
  scaleUmPerPx: number,
  overlapped: boolean,
  id: number,
): DetectedObject {
  const size = inter.engine.width;
  const { pixels, bbox, centroid } = basin;
  const mom = momentsFromPixels(pixels);
  const contour = traceContour(pixels, size, size);
  // 凸包只基于边界轮廓，避免对整区域上万像素排序导致调用栈溢出
  const hull = convexHull(contour.length >= 3 ? contour : pixels);
  const area = pixels.length;
  const perim = contour.length > 2 ? polygonPerimeter(contour) : Math.sqrt(area) * 3.5;
  const hullArea = Math.max(polygonArea(hull), 1);
  const hullPerim = polygonPerimeter(hull);
  const circularity = clamp((4 * Math.PI * area) / (perim * perim || 1), 0, 1);
  const solidity = clamp(area / hullArea, 0, 1);
  const convexity = clamp(hullPerim / (perim || 1), 0, 1);
  const equivDiameterPx = 2 * Math.sqrt(area / Math.PI);
  const aspectRatio = mom.minorAxis > 0.5 ? mom.majorAxis / Math.max(mom.minorAxis, 0.5) : 1;
  const extent = area / (bbox.w * bbox.h || 1);

  const tips = detectTips(contour, 72, 3);
  const tipAngles = tips.map((t) => t.angle);
  const tipCount = tips.length;
  const tipSharpness = tipAngles.length
    ? clamp(1 - mean(tipAngles) / 120, 0, 1)
    : 0;

  // 壁厚：综合几何内切半径与内腔/壁带的实际灰度差。
  // 实心结构（晶体/淀粉）内外灰度一致 → wallRatio 低；石细胞内腔亮、壁深 → wallRatio 高。
  let maxDist = 0;
  let sumGray = 0;
  let rimEnergy = 0;
  let rimCount = 0;
  let interiorEdge = 0;
  let interiorCount = 0;
  let textureEnergy = 0;
  let coreGraySum = 0;
  let coreCount = 0;
  let wallGraySum = 0;
  let wallCount = 0;
  for (const p of pixels) {
    const i = p.y * size + p.x;
    const d = inter.distance[i];
    if (d > maxDist) maxDist = d;
    const g = inter.normalized[i * 4];
    sumGray += g;
    textureEnergy += inter.variance[i];
    if (d < 2.2) {
      rimEnergy += inter.edge[i];
      rimCount++;
    } else if (d > maxDist * 0.45) {
      // 深距内部区域的边缘 = 内部纹理（气泡此处应接近 0）
      interiorEdge += inter.edge[i];
      interiorCount++;
    }
    if (d > maxDist * 0.6) {
      coreGraySum += g;
      coreCount++;
    } else if (d < maxDist * 0.4) {
      wallGraySum += g;
      wallCount++;
    }
  }
  const interiorEnergy = interiorCount ? interiorEdge / interiorCount : 0;
  const coreGray = coreCount ? coreGraySum / coreCount : 0;
  const wallGray = wallCount ? wallGraySum / wallCount : coreGray;
  // 内腔比壁带明显更亮（染色浅）才认定存在显著内腔；无对比则视为实心结构，壁厚归零
  const lumenContrast = clamp((coreGray - wallGray - 0.03) / 0.25, 0, 1);
  const geomWall = clamp(1 - (maxDist / (equivDiameterPx / 2)) ** 2, 0, 1);
  const wallRatio = clamp(geomWall * lumenContrast, 0, 1);
  const lumenRatio = clamp(1 - wallRatio, 0, 1);
  const meanDensity = sumGray / area;
  // 纹理能量：方差模糊后偏弱，融合内部边缘能量（折光面/纹理线 → 高；空泡 → 低）
  textureEnergy = clamp(textureEnergy / area + interiorEnergy * 0.6, 0, 1);
  rimEnergy = rimCount ? rimEnergy / rimCount : 0;

  const { spots } = countDarkSpots(basin, inter);
  // 纹孔密度按周长归一，并限制合理上限（药典量级 0~25 个/100μm），防止小目标周长过小而爆炸
  const pitDensity = clamp((spots / Math.max(perim, 1)) * 100, 0, 30);
  const { scores: patternScore, ridgeDensity } = vesselPatternScores(basin, inter);

  // 淀粉脐点：中心小而深的暗点
  let hilum = false;
  let cleft = false;
  const cIdx = Math.round(centroid.y) * size + Math.round(centroid.x);
  if (pixels.some((p) => p.y * size + p.x === cIdx)) {
    const centerGray = inter.normalized[cIdx * 4];
    hilum = centerGray < meanDensity - 0.12 && equivDiameterPx < 26;
    // 裂缝：中心暗区在一个方向上拉长
    let darkH = 0;
    let darkV = 0;
    for (let r = 1; r <= 4; r++) {
      const hx = Math.round(centroid.x) + r;
      const hy = Math.round(centroid.y);
      const vx = Math.round(centroid.x);
      const vy = Math.round(centroid.y) + r;
      if (hx < size && inter.normalized[hy * size + hx] * 4 < meanDensity - 0.05) darkH++;
      if (vy < size && inter.normalized[vy * size + vx] * 4 < meanDensity - 0.05) darkV++;
    }
    cleft = hilum && Math.abs(darkH - darkV) >= 2;
  }

  // 花粉刺状雕纹：轮廓高频起伏 + 圆形
  const spiny = circularity > 0.72 && tipCount >= 10 && tipSharpness > 0.45 && equivDiameterPx > 22;

  const features: MeasuredFeatures = {
    areaPx: area,
    perimeterPx: perim,
    equivDiameterPx,
    majorAxisPx: mom.majorAxis,
    minorAxisPx: mom.minorAxis,
    aspectRatio,
    circularity,
    solidity,
    convexity,
    eccentricity: mom.eccentricity,
    extent: clamp(extent, 0, 1),
    radialSymmetry: radialSymmetry(contour, centroid.x, centroid.y),
    wallRatio,
    lumenRatio,
    tipAngles,
    tipCount,
    tipSharpness,
    pitDensity,
    ridgeDensity,
    patternScore,
    hilum,
    cleft,
    spiny,
    meanDensity,
    textureEnergy,
    interiorEnergy,
    rimEnergy,
  };

  const poly = simplifyPolygon(contour, 1.2).slice(0, 60);
  return {
    id,
    type: 'debris',
    confidence: 0,
    typeScores: {},
    bbox,
    centroid,
    polygon: poly.length >= 3 ? poly : hull.slice(0, 24),
    features,
    diameterUm: equivDiameterPx * scaleUmPerPx,
    lengthUm: mom.majorAxis * scaleUmPerPx,
    overlapped,
    edited: false,
    hidden: false,
  };
}

export function measureAllObjects(
  inter: GpuIntermediate,
  scaleUmPerPx: number,
  minArea = 18,
): DetectedObject[] {
  const size = inter.engine.width;
  // 以连通域为基础单元分组像素
  const regionPixels = new Map<number, Pt[]>();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const r = inter.regionLabels[idx];
      if (!r || !inter.mask[idx]) continue;
      let arr = regionPixels.get(r);
      if (!arr) {
        arr = [];
        regionPixels.set(r, arr);
      }
      arr.push({ x, y });
    }
  }

  const out: DetectedObject[] = [];
  let id = 0;
  for (const [regionId, pixels] of regionPixels) {
    if (pixels.length < minArea) continue;
    const overlapped = inter.overlappedRegions.has(regionId);
    if (!overlapped) {
      // 单峰连通域：整体作为一个目标，避免分水岭误合并
      const bbox = bboxOf(pixels, size);
      const centroid = centroidOf(pixels);
      const basin: BasinData = { id: regionId, pixels, bbox, centroid };
      out.push(measureBasin(basin, inter, scaleUmPerPx, false, ++id));
    } else {
      // 多峰（重叠）区域：用水渍岭盆地拆分
      const sub = new Map<number, Pt[]>();
      for (const p of pixels) {
        const lab = inter.basinLabels[p.y * size + p.x];
        if (!lab) continue;
        let arr = sub.get(lab);
        if (!arr) {
          arr = [];
          sub.set(lab, arr);
        }
        arr.push(p);
      }
      for (const [, subPixels] of sub) {
        if (subPixels.length < minArea) continue;
        const basin: BasinData = {
          id: regionId,
          pixels: subPixels,
          bbox: bboxOf(subPixels, size),
          centroid: centroidOf(subPixels),
        };
        out.push(measureBasin(basin, inter, scaleUmPerPx, true, ++id));
      }
    }
  }
  return out;
}

function bboxOf(pixels: Pt[], size: number): BBox {
  let minX = size,
    minY = size,
    maxX = 0,
    maxY = 0;
  for (const p of pixels) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function centroidOf(pixels: Pt[]): Pt {
  let sx = 0,
    sy = 0;
  for (const p of pixels) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pixels.length, y: sy / pixels.length };
}
