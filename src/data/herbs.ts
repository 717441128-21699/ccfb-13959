import type { HerbProfile } from '../types';

/**
 * 内置药典显微特征表(示例种子数据)。
 * 结构与定性描述依据《中国药典》粉末显微鉴别通则及常见教材描述整理;
 * 【注意】所有数值范围为像素占位/经验初值,投产前必须由药检所用标定标本
 * 逐味校准(系统设置中可改 μm/px 标定系数,并在线编辑此表)。
 */
export const HERB_PROFILES: HerbProfile[] = [
  {
    id: 'dahuang',
    name: '大黄',
    latinName: 'Rhei Radix et Rhizoma',
    source: '药典/教材常见粉末特征(数值待校准)',
    features: [
      {
        type: 'calcium_cluster',
        hallmark: true,
        diameterRange: [40, 140],
        sharpnessRange: [0.55, 1.0],
        description: '草酸钙簇晶极多,棱角多短钝或宽大,直径大,含晶薄壁细胞常成行排列',
      },
      {
        type: 'starch',
        hallmark: false,
        diameterRange: [4, 20],
        description: '淀粉粒单粒类球形,复粒多见',
      },
      {
        type: 'vessel',
        hallmark: false,
        vesselKinds: ['reticulate', 'annular'],
        description: '具网纹、环纹导管,非木化',
      },
    ],
  },
  {
    id: 'renshen',
    name: '人参',
    latinName: 'Ginseng Radix et Rhizoma',
    source: '药典/教材常见粉末特征(数值待校准)',
    features: [
      {
        type: 'calcium_cluster',
        hallmark: true,
        diameterRange: [20, 55],
        sharpnessRange: [0.55, 1.0],
        description: '草酸钙簇晶棱角尖锐,直径较小,散在于薄壁细胞中',
      },
      {
        type: 'vessel',
        hallmark: false,
        vesselKinds: ['reticulate', 'spiral'],
        description: '网纹、螺纹导管',
      },
      {
        type: 'starch',
        hallmark: false,
        diameterRange: [4, 18],
        description: '淀粉粒众多,单粒或复粒',
      },
    ],
  },
  {
    id: 'gancao',
    name: '甘草',
    latinName: 'Glycyrrhizae Radix et Rhizoma',
    source: '药典/教材常见粉末特征(数值待校准)',
    features: [
      {
        type: 'fiber',
        hallmark: true,
        wallLumenRatioRange: [1.5, 4],
        description: '纤维成束,壁厚、胞腔狭窄,周围薄壁细胞常含草酸钙方晶(晶纤维)',
      },
      {
        type: 'calcium_cluster',
        hallmark: false,
        diameterRange: [15, 45],
        description: '草酸钙方晶多见(本系统先按簇晶大类统计,后续细分方晶)',
      },
      {
        type: 'vessel',
        hallmark: true,
        vesselKinds: ['bordered_pit', 'reticulate'],
        diameterRange: [20, 60],
        description: '具缘纹孔导管较大,纹孔椭圆形',
      },
      {
        type: 'starch',
        hallmark: false,
        diameterRange: [3, 16],
        description: '淀粉粒单粒卵圆形',
      },
    ],
  },
  {
    id: 'huanglian',
    name: '黄连',
    latinName: 'Coptidis Rhizoma',
    source: '药典/教材常见粉末特征(数值待校准)',
    features: [
      {
        type: 'stone_cell',
        hallmark: true,
        diameterRange: [25, 80],
        pitDensityRange: [0.05, 0.18],
        description: '石细胞鲜黄色,类方形/类圆形,壁厚,层纹明显,纹孔稀疏',
      },
      {
        type: 'fiber',
        hallmark: true,
        wallLumenRatioRange: [2, 5],
        description: '韧皮纤维黄色,纺锤形,壁厚',
      },
      {
        type: 'starch',
        hallmark: false,
        diameterRange: [2, 12],
        description: '淀粉粒细小',
      },
    ],
  },
  {
    id: 'huangbo',
    name: '黄柏',
    latinName: 'Phellodendri Chinensis Cortex',
    source: '药典/教材常见粉末特征(数值待校准)',
    features: [
      {
        type: 'fiber',
        hallmark: true,
        wallLumenRatioRange: [2, 6],
        description: '纤维鲜黄色,常成束,周围细胞含草酸钙方晶形成晶纤维',
      },
      {
        type: 'stone_cell',
        hallmark: true,
        diameterRange: [30, 120],
        pitDensityRange: [0.02, 0.12],
        description: '石细胞多分枝状(黄柏特征),壁厚、层纹细密,纹孔少',
      },
      {
        type: 'calcium_cluster',
        hallmark: false,
        description: '草酸钙方晶极多(按簇晶大类统计)',
      },
    ],
  },
  {
    id: 'houpo',
    name: '厚朴',
    latinName: 'Magnoliae Officinalis Cortex',
    source: '药典/教材常见粉末特征(数值待校准)',
    features: [
      {
        type: 'stone_cell',
        hallmark: true,
        diameterRange: [30, 90],
        pitDensityRange: [0.04, 0.15],
        description: '石细胞不规则分枝状,壁厚,有的可见层纹',
      },
      {
        type: 'fiber',
        hallmark: true,
        wallLumenRatioRange: [1.5, 4],
        description: '纤维壁甚厚,木化,孔沟不明显',
      },
      {
        type: 'vessel',
        hallmark: false,
        vesselKinds: ['reticulate', 'bordered_pit'],
        description: '网纹/具缘纹孔导管',
      },
    ],
  },
  {
    id: 'rougui',
    name: '肉桂',
    latinName: 'Cinnamomi Cortex',
    source: '药典/教材常见粉末特征(数值待校准)',
    features: [
      {
        type: 'fiber',
        hallmark: true,
        wallLumenRatioRange: [2.5, 6],
        description: '纤维多单个散在,长梭形,壁厚,木化',
      },
      {
        type: 'stone_cell',
        hallmark: true,
        diameterRange: [20, 70],
        pitDensityRange: [0.08, 0.25],
        description: '石细胞类方形,壁厚,有的三面厚一面薄,纹孔较密',
      },
      {
        type: 'starch',
        hallmark: false,
        diameterRange: [4, 18],
        description: '淀粉粒圆球形',
      },
    ],
  },
  {
    id: 'dingxiang',
    name: '丁香',
    latinName: 'Caryophylli Flos',
    source: '药典/教材常见粉末特征(数值待校准)',
    features: [
      {
        type: 'calcium_cluster',
        hallmark: true,
        diameterRange: [10, 40],
        sharpnessRange: [0.4, 0.9],
        description: '草酸钙簇晶众多,较小,棱角较尖',
      },
      {
        type: 'pollen',
        hallmark: true,
        diameterRange: [15, 35],
        description: '花粉粒三角形,具三萌发孔(极面观)',
      },
      {
        type: 'fiber',
        hallmark: false,
        description: '纤维梭形,壁厚',
      },
    ],
  },
  {
        id: 'jinyinhua',
    name: '金银花',
    latinName: 'Lonicerae Japonicae Flos',
    source: '药典/教材常见粉末特征(数值待校准)',
    features: [
      {
        type: 'pollen',
        hallmark: true,
        diameterRange: [15, 40],
        description: '花粉粒类球形,表面具细密短刺及颗粒状雕纹,具三萌发孔',
      },
      {
        type: 'calcium_cluster',
        hallmark: false,
        diameterRange: [8, 30],
        description: '草酸钙簇晶细小',
      },
      {
        type: 'vessel',
        hallmark: false,
        vesselKinds: ['spiral', 'reticulate'],
        description: '螺纹、网纹导管',
      },
    ],
  },
  {
    id: 'banxia',
    name: '半夏',
    latinName: 'Pinelliae Rhizoma',
    source: '药典/教材常见粉末特征(数值待校准)',
    features: [
      {
        type: 'calcium_needle',
        hallmark: true,
        description: '草酸钙针晶束存在于黏液细胞中,针晶纤细成束',
      },
      {
        type: 'starch',
        hallmark: true,
        diameterRange: [3, 24],
        description: '淀粉粒甚多,单粒类球形/半圆形,脐点裂隙状',
      },
      {
        type: 'vessel',
        hallmark: false,
        vesselKinds: ['spiral', 'annular'],
        description: '螺纹、环纹导管',
      },
    ],
  },
  {
    id: 'puhuang',
    name: '蒲黄',
    latinName: 'Typhae Pollen',
    source: '药典/教材常见粉末特征(数值待校准)',
    features: [
      {
        type: 'pollen',
        hallmark: true,
        diameterRange: [12, 30],
        description: '花粉粒类球形,表面有网状雕纹,单萌发孔',
      },
      {
        type: 'starch',
        hallmark: false,
        description: '淀粉粒少见',
      },
    ],
  },
];
