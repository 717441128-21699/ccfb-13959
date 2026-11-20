/**
 * GLSL ES 3.00 着色器源码。
 * 管线:白平衡+亮度 → 局部均值(可分离盒式模糊)→ 局部对比度归一化
 *      → Sobel 边缘 → 双极性自适应阈值(暗结构/亮晶体都抓)→ 形态学开闭运算 → 打包回读。
 * 分类阶段完全不使用颜色,颜色只在本文件内用于生成亮度图。
 */

export const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uSrc;
uniform vec2 uTexel;`;

/** 灰度世界白平衡 + 亮度。uMean 为 CPU 计算的全图 RGB 均值(灰度世界假设)。 */
export const FRAG_LUMA = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uImg;
uniform vec3 uMean;
void main(){
  vec3 mean = uMean;
  vec3 img  = texture(uImg, vUv).rgb;
  float g = dot(mean, vec3(0.3333));
  vec3 bal = img * (g / max(mean, vec3(0.001)));
  float L = dot(clamp(bal, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
  frag = vec4(L, 0.0, 0.0, 1.0);
}`;

/** 可分离盒式模糊,uDir=(1/w,0) 或 (0,1/h),半径 4(9 tap),小半径减少跨结构混合。 */
export const FRAG_BOXBLUR = `${COMMON}
uniform vec2 uDir;
void main(){
  float sum = 0.0;
  for(int i=-4;i<=4;i++){
    sum += texture(uSrc, vUv + uDir * float(i)).r;
  }
  frag = vec4(sum / 9.0, 0.0, 0.0, 1.0);
}`;

/** 局部对比度归一化:减去局部均值并按增益展开,抑制染色深浅与光照不均。 */
export const FRAG_NORMALIZE = `${COMMON}
uniform sampler2D uMean;
void main(){
  float L = texture(uSrc, vUv).r;
  float m = texture(uMean, vUv).r;
  float n = clamp((L - m) * 4.5 + 0.5, 0.0, 1.0);
  frag = vec4(n, 0.0, 0.0, 1.0);
}`;

/** Sobel 梯度幅值。 */
export const FRAG_SOBEL = `${COMMON}
void main(){
  float tl = texture(uSrc, vUv + uTexel * vec2(-1.0,-1.0)).r;
  float tc = texture(uSrc, vUv + uTexel * vec2( 0.0,-1.0)).r;
  float tr = texture(uSrc, vUv + uTexel * vec2( 1.0,-1.0)).r;
  float ml = texture(uSrc, vUv + uTexel * vec2(-1.0, 0.0)).r;
  float mr = texture(uSrc, vUv + uTexel * vec2( 1.0, 0.0)).r;
  float bl = texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).r;
  float bc = texture(uSrc, vUv + uTexel * vec2( 0.0, 1.0)).r;
  float br = texture(uSrc, vUv + uTexel * vec2( 1.0, 1.0)).r;
  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
  // Sobel 理论最大幅值约 4*sqrt(2)≈5.66,归一化到 0..1;归一化图对比度已放大,不再额外增益
  float mag = clamp(length(vec2(gx, gy)) / 5.66, 0.0, 1.0);
  frag = vec4(mag, 0.0, 0.0, 1.0);
}`;

/**
 * 双极性自适应阈值(在归一化亮度域内判断)。
 * 归一化图 n = clamp((L-mean)*4+0.5, 0,1),其统计均值约为 0.5;
 * 偏离 0.5 超过 uC 即判为结构(暗的木质化结构或亮的草酸钙结晶)。
 */
export const FRAG_THRESHOLD = `${COMMON}
uniform float uC;
void main(){
  float n = texture(uSrc, vUv).r;
  float mask = (n < 0.5 - uC || n > 0.5 + uC) ? 1.0 : 0.0;
  frag = vec4(mask, 0.0, 0.0, 1.0);
}`;

/** 3x3 形态学:uOp=0 腐蚀(min),uOp=1 膨胀(max),只处理 R 通道。 */
export const FRAG_MORPH = `${COMMON}
uniform int uOp;
void main(){
  float v = texture(uSrc, vUv).r;
  for(int dy=-1;dy<=1;dy++){
    for(int dx=-1;dx<=1;dx++){
      float s = texture(uSrc, vUv + uTexel * vec2(float(dx), float(dy))).r;
      v = (uOp == 1) ? max(v, s) : min(v, s);
    }
  }
  frag = vec4(v, 0.0, 0.0, 1.0);
}`;

/** 降采样到小尺寸(64x64),用于 CPU 侧求全图灰度世界均值。 */
export const FRAG_DOWNSAMPLE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uImg;
void main(){
  frag = texture(uImg, vUv);
}`;

/** 打包:R=掩膜 G=边缘 B=归一化亮度 A=原始亮度,一次 readPixels 全部回读。 */export const FRAG_PACK = `${COMMON}
uniform sampler2D uMask;
uniform sampler2D uEdge;
uniform sampler2D uNorm;
uniform sampler2D uLuma;
void main(){
  frag = vec4(
    texture(uMask, vUv).r,
    texture(uEdge, vUv).r,
    texture(uNorm, vUv).r,
    texture(uLuma, vUv).r
  );
}`;
