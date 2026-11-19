// 全局领域类型定义

/** 显微特征结构类别 */
export type StructureType =
  | 'cluster_crystal' // 草酸钙簇晶
  | 'prism_crystal' // 草酸钙方晶
  | 'stone_cell' // 石细胞
  | 'vessel' // 导管
  | 'fiber' // 纤维
  | 'crystal_fiber' // 晶纤维
  | 'starch' // 淀粉粒
  | 'pollen' // 花粉粒
  | 'bubble' // 气泡（干扰物，不计入鉴别）
  | 'debris'; // 碎片/未识别

export const ALL_STRUCTURE_TYPES: StructureType[] = [
  'cluster_crystal',
  'prism_crystal',
  'stone_cell',
  'vessel',
  'fiber',
  'crystal_fiber',
  'starch',
  'pollen',
  'bubble',
  'debris',
];

export const STRUCTURE_LABEL: Record<StructureType, string> = {
  cluster_crystal: '草酸钙簇晶',
  prism_crystal: '草酸钙方晶',
  stone_cell: '石细胞',
  vessel: '导管',
  fiber: '纤维',
  crystal_fiber: '晶纤维',
  starch: '淀粉粒',
  pollen: '花粉粒',
  bubble: '气泡(干扰)',
  debris: '碎片',
};

/** 导管纹理亚型 */
export type VesselPattern =
  | 'reticulate' // 网纹
  | 'pitted' // 纹孔
  | 'bordered_pitted' // 具缘纹孔
  | 'spiral' // 螺纹
  | 'annular'; // 环纹

export const VESSEL_PATTERN_LABEL: Record<VesselPattern, string> = {
  reticulate: '网纹',
  pitted: '纹孔',
  bordered_pitted: '具缘纹孔',
  spiral: '螺纹',
  annular: '环纹',
};

/** 可被药典条目约束的连续性状名 */
export type TraitName =
  | 'diameter' // 等效直径 μm
  | 'length' // 长轴 μm
  | 'aspectRatio'
  | 'tipAngle' // 棱角内角（度），越小越锐
  | 'tipCount'
  | 'wallRatio' // 壁厚占比
  | 'pitDensity' // 纹孔密度（个/100μm 周长）
  | 'ridgeDensity' // 纹理线密度（条/100μm）
  | 'solidity'
  | 'circularity';

/** 模糊区间：[lo,hi] 为典型范围，tol 为软容忍宽度 */
export interface RangedTrait {
  lo: number;
  hi: number;
  tol?: number;
}

export interface ExpectedStructure {
  type: StructureType;
  /** 单视野期望数量级别：0 无 / 1 偶见 / 3 少量 / 8 常见 / 20 多量 */
  abundance: number;
  subtype?: VesselPattern;
  traits?: Partial<Record<TraitName, RangedTrait>>;
  text: string; // 药典/教材原文描述
}

export interface DrugProfile {
  id: string;
  name: string;
  pinyin: string;
  latin: string;
  category: string;
  structures: ExpectedStructure[];
  keyTraits: string[];
}

/** 单个连通块的测量特征 */
export interface MeasuredFeatures {
  areaPx: number;
  perimeterPx: number;
  equivDiameterPx: number;
  majorAxisPx: number;
  minorAxisPx: number;
  aspectRatio: number;
  circularity: number; // 4πA/P²
  solidity: number; // A / 凸包面积
  convexity: number; // 凸包周长 / 轮廓周长
  eccentricity: number;
  extent: number; // 面积 / 外接矩形面积
  radialSymmetry: number; // 0..1
  wallRatio: number; // 壁厚面积占比
  lumenRatio: number; // 内腔面积占比
  tipAngles: number[]; // 棱角内角
  tipCount: number;
  tipSharpness: number; // 0..1，越大越锐
  pitDensity: number; // 每 100μm 周长的纹孔数
  ridgeDensity: number; // 每 100μm 宽的纹理条数
  patternScore: Record<VesselPattern, number>;
  hilum: boolean; // 淀粉脐点
  cleft: boolean; // 裂缝状脐点
  spiny: boolean; // 花粉刺状雕纹
  meanDensity: number; // 归一化光密度
  textureEnergy: number; // 内部纹理能量
  interiorEnergy: number; // 深距内部区域的边缘能量（气泡≈0）
  rimEnergy: number; // 边缘环带能量
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectedObject {
  id: number;
  type: StructureType;
  confidence: number;
  typeScores: Partial<Record<StructureType, number>>;
  subtype?: VesselPattern;
  bbox: BBox;
  centroid: { x: number; y: number };
  polygon: { x: number; y: number }[];
  features: MeasuredFeatures;
  diameterUm: number;
  lengthUm: number;
  overlapped: boolean;
  edited: boolean;
  hidden: boolean;
}

export interface DetectionResult {
  width: number;
  height: number;
  scaleUmPerPx: number;
  objects: DetectedObject[];
  counts: Record<StructureType, number>;
  timingMs: number;
  gpuMs: number;
  cpuMs: number;
}

export interface EvidenceLine {
  text: string;
  hit: boolean;
  weight: number;
}

export interface DrugMatch {
  drugId: string;
  drugName: string;
  score: number;
  evidence: EvidenceLine[];
  missing: EvidenceLine[];
}

export interface MixtureResult {
  detected: boolean;
  components: string[];
  confidence: number;
  reason: string;
}

export interface SampleReport {
  imageName: string;
  result: DetectionResult;
  matches: DrugMatch[];
  mixture: MixtureResult;
}

/** 合成图金标准 */
export interface GroundTruthObject {
  type: StructureType;
  subtype?: VesselPattern;
  x: number;
  y: number;
  radius: number;
  bbox: BBox;
  traits: Partial<Record<TraitName, number>>;
}

export interface SyntheticSample {
  canvas: HTMLCanvasElement;
  groundTruth: GroundTruthObject[];
  scaleUmPerPx: number;
  stainPreset: string;
  drugs: string[];
}
