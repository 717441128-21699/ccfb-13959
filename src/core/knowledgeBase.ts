import type { DrugProfile } from './types';

/**
 * 中药粉末显微鉴别知识库
 * 条目依据《中国药典》粉末显微鉴别项及《中药鉴定学》统编教材描述整理，
 * 连续性状（大小、棱角、纹孔密度等）给出可计算区间，文字描述保留原文要点。
 * 区间单位：长度 μm，角度 度，密度 个/100μm。
 */
export const DRUG_PROFILES: DrugProfile[] = [
  {
    id: 'dahuang',
    name: '大黄',
    pinyin: 'Dahuang',
    latin: 'Rhei Radix et Rhizoma',
    category: '根及根茎类',
    keyTraits: ['大型簇晶棱角短钝', '大型网纹/具缘纹孔导管', '淀粉粒众多'],
    structures: [
      {
        type: 'cluster_crystal',
        abundance: 20,
        traits: {
          diameter: { lo: 30, hi: 110, tol: 12 },
          tipAngle: { lo: 42, hi: 95, tol: 10 }, // 棱角短钝
          tipCount: { lo: 8, hi: 18, tol: 2 },
        },
        text: '草酸钙簇晶极多，大型，棱角多短钝，有的呈不规则矩圆形',
      },
      {
        type: 'vessel',
        abundance: 8,
        subtype: 'reticulate',
        traits: { diameter: { lo: 40, hi: 140, tol: 15 }, ridgeDensity: { lo: 6, hi: 14, tol: 3 } },
        text: '具缘纹孔导管、网纹导管大型，非木化',
      },
      {
        type: 'starch',
        abundance: 20,
        traits: { diameter: { lo: 3, hi: 18, tol: 4 } },
        text: '淀粉粒单粒类球形或长圆形，脐点星状',
      },
    ],
  },
  {
    id: 'renshen',
    name: '人参',
    pinyin: 'Renshen',
    latin: 'Ginseng Radix et Rhizoma',
    category: '根及根茎类',
    keyTraits: ['簇晶棱角锐尖', '树脂道碎片', '网纹/梯纹导管'],
    structures: [
      {
        type: 'cluster_crystal',
        abundance: 12,
        traits: {
          diameter: { lo: 12, hi: 48, tol: 10 },
          tipAngle: { lo: 12, hi: 40, tol: 8 }, // 棱角锐尖
          tipCount: { lo: 5, hi: 13, tol: 2 },
        },
        text: '草酸钙簇晶棱角锐尖，直径至 40μm 以上',
      },
      {
        type: 'vessel',
        abundance: 6,
        subtype: 'reticulate',
        traits: { diameter: { lo: 18, hi: 55, tol: 10 }, ridgeDensity: { lo: 8, hi: 18, tol: 3 } },
        text: '网纹、梯纹导管，旁有树脂道碎片含黄色分泌物',
      },
      {
        type: 'starch',
        abundance: 14,
        traits: { diameter: { lo: 4, hi: 20, tol: 4 } },
        text: '淀粉粒众多，单粒类球形，脐点点状或裂隙状',
      },
    ],
  },
  {
    id: 'huanglian',
    name: '黄连',
    pinyin: 'Huanglian',
    latin: 'Coptidis Rhizoma',
    category: '根及根茎类',
    keyTraits: '鲜黄色石细胞壁孔疏、鳞叶表皮细胞'.split('、'),
    structures: [
      {
        type: 'stone_cell',
        abundance: 10,
        traits: {
          diameter: { lo: 18, hi: 58, tol: 10 },
          wallRatio: { lo: 0.32, hi: 0.58, tol: 0.08 },
          pitDensity: { lo: 3, hi: 9, tol: 2 }, // 孔沟稀疏
          tipCount: { lo: 3, hi: 6, tol: 1 },
        },
        text: '石细胞鲜黄色，类方形或类多角形，壁厚，层纹明显，孔沟稀疏',
      },
      {
        type: 'fiber',
        abundance: 6,
        traits: { diameter: { lo: 8, hi: 22, tol: 5 }, aspectRatio: { lo: 4, hi: 14, tol: 1.5 } },
        text: '韧皮纤维鲜黄色，纺锤形，壁厚',
      },
      {
        type: 'vessel',
        abundance: 4,
        subtype: 'pitted',
        traits: { diameter: { lo: 10, hi: 30, tol: 6 } },
        text: '导管细小，孔纹或网纹',
      },
      {
        type: 'starch',
        abundance: 8,
        traits: { diameter: { lo: 2, hi: 10, tol: 3 } },
        text: '淀粉粒细小',
      },
    ],
  },
  {
    id: 'huangqin',
    name: '黄芩',
    pinyin: 'Huangqin',
    latin: 'Scutellariae Radix',
    category: '根及根茎类',
    keyTraits: ['石细胞壁厚纹孔密', '韧皮纤维梭形', '网纹导管'],
    structures: [
      {
        type: 'stone_cell',
        abundance: 12,
        traits: {
          diameter: { lo: 22, hi: 72, tol: 12 },
          wallRatio: { lo: 0.4, hi: 0.68, tol: 0.08 },
          pitDensity: { lo: 9, hi: 18, tol: 3 }, // 纹孔明显而密
          tipCount: { lo: 4, hi: 8, tol: 1 },
        },
        text: '石细胞淡黄色，类圆形或不规则形，壁厚，纹孔密集而明显',
      },
      {
        type: 'fiber',
        abundance: 10,
        traits: { diameter: { lo: 10, hi: 28, tol: 6 }, aspectRatio: { lo: 5, hi: 16, tol: 2 } },
        text: '韧皮纤维梭形，壁厚，孔沟细',
      },
      {
        type: 'vessel',
        abundance: 6,
        subtype: 'reticulate',
        traits: { diameter: { lo: 18, hi: 50, tol: 8 } },
        text: '网纹导管多见',
      },
      {
        type: 'starch',
        abundance: 6,
        traits: { diameter: { lo: 3, hi: 12, tol: 3 } },
        text: '淀粉粒类球形',
      },
    ],
  },
  {
    id: 'gancao',
    name: '甘草',
    pinyin: 'Gancao',
    latin: 'Glycyrrhizae Radix et Rhizoma',
    category: '根及根茎类',
    keyTraits: ['晶纤维成束', '具缘纹孔导管大', '方晶'],
    structures: [
      {
        type: 'crystal_fiber',
        abundance: 16,
        traits: { diameter: { lo: 10, hi: 26, tol: 5 }, aspectRatio: { lo: 5, hi: 16, tol: 2 } },
        text: '晶纤维成束，纤维束周围薄壁细胞含草酸钙方晶',
      },
      {
        type: 'prism_crystal',
        abundance: 12,
        traits: { diameter: { lo: 8, hi: 24, tol: 5 } },
        text: '草酸钙方晶略呈扁方形',
      },
      {
        type: 'vessel',
        abundance: 10,
        subtype: 'bordered_pitted',
        traits: { diameter: { lo: 45, hi: 160, tol: 20 }, pitDensity: { lo: 10, hi: 22, tol: 4 } },
        text: '具缘纹孔导管较大，纹孔椭圆形或球状',
      },
      {
        type: 'starch',
        abundance: 14,
        traits: { diameter: { lo: 3, hi: 16, tol: 4 } },
        text: '淀粉粒众多，单粒卵圆形或球形',
      },
    ],
  },
  {
    id: 'huangqi',
    name: '黄芪',
    pinyin: 'Huangqi',
    latin: 'Astragali Radix',
    category: '根及根茎类',
    keyTraits: ['纤维成束壁厚', '具缘纹孔导管', '淀粉粒多'],
    structures: [
      {
        type: 'fiber',
        abundance: 20,
        traits: { diameter: { lo: 8, hi: 24, tol: 5 }, aspectRatio: { lo: 6, hi: 20, tol: 2 }, wallRatio: { lo: 0.25, hi: 0.55, tol: 0.08 } },
        text: '纤维多成束，细长，壁厚，非木化',
      },
      {
        type: 'vessel',
        abundance: 8,
        subtype: 'bordered_pitted',
        traits: { diameter: { lo: 30, hi: 110, tol: 15 }, pitDensity: { lo: 8, hi: 18, tol: 3 } },
        text: '具缘纹孔导管，纹孔排列紧密',
      },
      {
        type: 'starch',
        abundance: 16,
        traits: { diameter: { lo: 3, hi: 14, tol: 3 } },
        text: '淀粉粒单粒类圆形',
      },
    ],
  },
  {
    id: 'huangbai',
    name: '黄柏',
    pinyin: 'Huangbai',
    latin: 'Phellodendri Chinensis Cortex',
    category: '皮类',
    keyTraits: ['分枝状石细胞', '晶纤维', '方晶'],
    structures: [
      {
        type: 'stone_cell',
        abundance: 14,
        traits: {
          diameter: { lo: 25, hi: 80, tol: 12 },
          wallRatio: { lo: 0.4, hi: 0.7, tol: 0.08 },
          pitDensity: { lo: 6, hi: 13, tol: 3 },
          solidity: { lo: 0.5, hi: 0.75, tol: 0.08 }, // 分枝
          tipCount: { lo: 5, hi: 10, tol: 2 },
        },
        text: '石细胞鲜黄色，多分枝，壁厚，层纹明显',
      },
      {
        type: 'crystal_fiber',
        abundance: 14,
        traits: { diameter: { lo: 10, hi: 24, tol: 5 }, aspectRatio: { lo: 5, hi: 14, tol: 2 } },
        text: '晶纤维鲜黄色，方晶含于周围薄壁细胞',
      },
      {
        type: 'prism_crystal',
        abundance: 10,
        traits: { diameter: { lo: 8, hi: 22, tol: 4 } },
        text: '草酸钙方晶较多',
      },
    ],
  },
  {
    id: 'houpo',
    name: '厚朴',
    pinyin: 'Houpo',
    latin: 'Magnoliae Officinalis Cortex',
    category: '皮类',
    keyTraits: ['石细胞强分枝', '油细胞', '纤维壁厚'],
    structures: [
      {
        type: 'stone_cell',
        abundance: 16,
        traits: {
          diameter: { lo: 30, hi: 95, tol: 14 },
          wallRatio: { lo: 0.45, hi: 0.75, tol: 0.08 },
          pitDensity: { lo: 4, hi: 11, tol: 2 },
          solidity: { lo: 0.38, hi: 0.62, tol: 0.08 }, // 强分枝
          tipCount: { lo: 7, hi: 13, tol: 2 },
        },
        text: '石细胞不规则分枝状，枝端尖锐，壁厚',
      },
      {
        type: 'fiber',
        abundance: 12,
        traits: { diameter: { lo: 9, hi: 26, tol: 5 }, aspectRatio: { lo: 6, hi: 18, tol: 2 }, wallRatio: { lo: 0.3, hi: 0.6, tol: 0.08 } },
        text: '纤维壁厚，木化',
      },
      {
        type: 'prism_crystal',
        abundance: 6,
        traits: { diameter: { lo: 7, hi: 18, tol: 4 } },
        text: '草酸钙方晶少见',
      },
    ],
  },
  {
    id: 'danggui',
    name: '当归',
    pinyin: 'Danggui',
    latin: 'Angelicae Sinensis Radix',
    category: '根及根茎类',
    keyTraits: ['油室碎片', '梯纹/网纹导管', '纺锤形薄壁细胞'],
    structures: [
      {
        type: 'vessel',
        abundance: 10,
        subtype: 'reticulate',
        traits: { diameter: { lo: 16, hi: 48, tol: 8 }, ridgeDensity: { lo: 7, hi: 16, tol: 3 } },
        text: '梯纹及网纹导管，直径至 50μm',
      },
      {
        type: 'fiber',
        abundance: 3,
        traits: { diameter: { lo: 8, hi: 20, tol: 4 }, aspectRatio: { lo: 4, hi: 10, tol: 2 } },
        text: '纺锤形韧皮薄壁细胞，壁稍厚',
      },
      {
        type: 'starch',
        abundance: 4,
        traits: { diameter: { lo: 2, hi: 12, tol: 3 } },
        text: '淀粉粒少，细小',
      },
    ],
  },
  {
    id: 'banxia',
    name: '半夏',
    pinyin: 'Banxia',
    latin: 'Pinelliae Rhizoma',
    category: '块茎类',
    keyTraits: ['淀粉粒极多脐点裂隙状', '螺纹/环纹导管', '黏液细胞'],
    structures: [
      {
        type: 'starch',
        abundance: 24,
        traits: { diameter: { lo: 2, hi: 11, tol: 3 } },
        text: '淀粉粒极多，单粒类球形或半球形，脐点裂隙状、人字状',
      },
      {
        type: 'vessel',
        abundance: 5,
        subtype: 'spiral',
        traits: { diameter: { lo: 8, hi: 24, tol: 5 }, ridgeDensity: { lo: 14, hi: 26, tol: 4 } },
        text: '螺纹导管为主，细小，非木化',
      },
      {
        type: 'cluster_crystal',
        abundance: 3,
        traits: { diameter: { lo: 10, hi: 30, tol: 6 }, tipAngle: { lo: 10, hi: 32, tol: 6 } },
        text: '黏液细胞中含草酸钙针晶束（按束状锐晶记录）',
      },
    ],
  },
];

export const DRUG_MAP: Record<string, DrugProfile> = Object.fromEntries(
  DRUG_PROFILES.map((d) => [d.id, d]),
);

/** 掺伪评测配对：主料 + 常见易混/惯用掺伪料 */
export const ADULTERATION_PAIRS: [string, string][] = [
  ['dahuang', 'tuhuangqi'], // 土大黄伪充大黄
  ['renshen', 'shangshen'], // 商陆伪充人参
  ['huanglian', 'huangqin'],
  ['gancao', 'huangqi'],
  ['banxia', 'huzhang'],
  ['huangbai', 'houpo'],
];

// 掺伪料复用既有档案中形态可区分的条目（评测时以 id 标注）
export const ADULTERANT_ALIAS: Record<string, string> = {
  tuhuangqi: 'dahuang',
  shangshen: 'huangqi',
  huzhang: 'huangqin',
};
