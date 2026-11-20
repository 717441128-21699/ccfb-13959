/**
 * 领域类型定义
 * 所有几何尺寸单位:像素(px);真实显微图可通过标定系数换算为 μm
 */

/** 药典显微鉴别中的特征结构类别 */
export type StructureType =
  | 'calcium_cluster' // 草酸钙簇晶
  | 'calcium_needle' // 草酸钙针晶
  | 'stone_cell' // 石细胞
  | 'vessel' // 导管
  | 'fiber' // 纤维
  | 'starch' // 淀粉粒
  | 'pollen'; // 花粉粒

export const STRUCTURE_LABELS: Record<StructureType, string> = {
  calcium_cluster: '草酸钙簇晶',
  calcium_needle: '草酸钙针晶',
  stone_cell: '石细胞',
  vessel: '导管',
  fiber: '纤维',
  starch: '淀粉粒',
  pollen: '花粉粒',
};

/** 导管类型(药典常见描述) */
export type VesselKind = 'reticulate' | 'pitted' | 'spiral' | 'annular' | 'bordered_pit';
export const VESSEL_KIND_LABELS: Record<VesselKind, string> = {
  reticulate: '网纹',
  pitted: '孔纹',
  spiral: '螺纹',
  annular: '环纹',
  bordered_pit: '具缘纹孔',
};

/**
 * 单个连通区域的几何/纹理描述子。
 * 分类与药典比对只使用这里的形态学量,不使用颜色 → 染色鲁棒性的基础。
 */
export interface RegionFeatures {
  id: number;
  type: StructureType | 'unknown';
  /** 分类置信度 0..1 */
  confidence: number;
  /** 各类别打分(可解释依据) */
  classScores: Partial<Record<StructureType, number>>;
  cx: number;
  cy: number;
  area: number;
  perimeter: number;
  /** 外接矩形 */
  bbox: { x: number; y: number; w: number; h: number };
  /** 等效圆直径 = 2*sqrt(area/π) */
  equivDiameter: number;
  /** 圆度 4πA/P²,圆=1 */
  circularity: number;
  /** 长宽比(长轴/短轴) */
  aspectRatio: number;
  /** 实心度 = 面积/凸包面积 */
  solidity: number;
  /** 区域内暗像素占比(刻画纹孔/纹理密度) */
  darkRatio: number;
  /** 区域平均归一化亮度(草酸钙结晶明显偏亮,木质化结构偏暗) */
  meanNormLuma: number;
  /** 区域内边缘像素占比(纹孔疏密、网状纹理) */
  edgeDensity: number;
  /** 方向(弧度,长轴方向) */
  orientation: number;
  /** 凸包顶点数(刻画棱角多少) */
  convexVertices: number;
  // —— 细粒度属性(对应药典文字描述)——
  /** 簇晶棱角锐度 0(钝)..1(尖),基于凸包顶点夹角 */
  crystalSharpness?: number;
  /** 石细胞壁纹孔密度(个/周长单位) */
  pitDensity?: number;
  /** 导管纹式 */
  vesselKind?: VesselKind;
  /** 纤维壁腔比(壁厚/腔径) */
  wallLumenRatio?: number;
  /** 实心度代理:无腔孔的实心长条(纤维/针晶)为 true,有腔管道(导管)为 false */
  solidElongated?: boolean;
}

/** 图上标注(机器自动生成或人工修改) */
export interface Annotation {
  id: string;
  type: StructureType;
  cx: number;
  cy: number;
  bbox: { x: number; y: number; w: number; h: number };
  source: 'auto' | 'human';
  confidence: number;
}

/** 一张图的分析结果 */
export interface ImageAnalysis {
  imageId: string;
  width: number;
  height: number;
  regions: RegionFeatures[];
  annotations: Annotation[];
  /** 各类别计数 */
  counts: Record<StructureType, number>;
  /** 各类别尺寸统计(等效直径 px) */
  sizeStats: Partial<Record<StructureType, { mean: number; min: number; max: number; n: number }>>;
  /** GPU/CPU 各阶段耗时 ms */
  timings: Record<string, number>;
}

/**
 * 药典单味药特征条目。
 * presence: 药典明确记载的特征;数值字段为示例范围,须由药检所用真实标本校准。
 */
export interface HerbProfile {
  id: string;
  name: string;
  latinName: string;
  /** 记载的结构类型及关键描述 */
  features: {
    type: StructureType;
    /** 是否为该药材的主要/标志性特征 */
    hallmark: boolean;
    /** 等效直径参考范围(px 占位;校准后可改 μm) */
    diameterRange?: [number, number];
    /** 药典原文式描述,用于结果页展示"依据" */
    description: string;
    /** 细属性约束 */
    sharpnessRange?: [number, number];
    pitDensityRange?: [number, number];
    vesselKinds?: VesselKind[];
    wallLumenRatioRange?: [number, number];
  }[];
  source: string;
}

/** 单味药的匹配得分与依据 */
export interface HerbMatch {
  herbId: string;
  herbName: string;
  score: number;
  /** 命中的标志性特征等,供检验员复核 */
  evidence: string[];
  missingHallmarks: string[];
}

/** 一个样品(多张图)的综合鉴定结果 */
export interface SampleVerdict {
  matches: HerbMatch[];
  /** 疑似掺伪:第二组成分解释得好的独立结构群 */
  adulteration: {
    detected: boolean;
    secondaryHerbId?: string;
    secondaryHerbName?: string;
    supportingTypes: StructureType[];
    reason: string;
  };
  aggregateCounts: Record<StructureType, number>;
  totalTimeMs: number;
}
