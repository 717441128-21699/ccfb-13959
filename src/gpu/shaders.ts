// 全部片元着色器（GLSL ES 3.00），逐像素 1:1 调度，使用 texelFetch

const HEADER = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uSize;
out vec4 outColor;
ivec2 P() { return ivec2(gl_FragCoord.xy); }
bool inside(ivec2 p) { return p.x>=0 && p.y>=0 && p.x<int(uSize.x) && p.y<int(uSize.y); }
`;

/** 染色归一化：RGB→光密度，按全图百分位拉伸；输出 灰度/饱和度/染色残差/原始亮度 */
export const NORMALIZE_FS = HEADER + `
uniform sampler2D uImg;
uniform vec3 uPLo;
uniform vec3 uPHi;
void main(){
  ivec2 p = P();
  vec3 rgb = texelFetch(uImg, p, 0).rgb;
  vec3 od = -log(max(rgb, vec3(0.004)));
  vec3 norm = clamp((od - uPLo) / max(uPHi - uPLo, vec3(0.02)), 0.0, 1.0);
  float g = dot(norm, vec3(0.299, 0.587, 0.114));
  float mx = max(norm.r, max(norm.g, norm.b));
  float mn = min(norm.r, min(norm.g, norm.b));
  float sat = mx - mn;
  // 染色轴残差：去除亮度后的色度方向，供“颜色不同但形态相同”时保持稳定
  float resid = length(norm - vec3(g));
  outColor = vec4(g, sat, resid, dot(rgb, vec3(0.299,0.587,0.114)));
}`;

/** 可分离盒式模糊（作用于 r 通道） */
export const BOX_BLUR_FS = HEADER + `
uniform sampler2D uSrc;
uniform vec2 uDir;
uniform int uRadius;
void main(){
  ivec2 p = P();
  float s = 0.0; float w = 0.0;
  for(int i=-8;i<=8;i++){
    if(i < -uRadius || i > uRadius) continue;
    ivec2 q = p + ivec2(uDir * float(i));
    if(inside(q)){ s += texelFetch(uSrc, q, 0).r; w += 1.0; }
  }
  outColor = vec4(s / max(w,1.0), 0.0, 0.0, 0.0);
}`;

/** 平方通道（供局部方差：box(g²) - box(g)²） */
export const SQUARE_FS = HEADER + `
uniform sampler2D uSrc;
void main(){
  float g = texelFetch(uSrc, P(), 0).r;
  outColor = vec4(g*g, 0.0, 0.0, 0.0);
}`;

/** 局部方差，复用两次盒式模糊结果 */
export const VARIANCE_FS = HEADER + `
uniform sampler2D uBoxG;
uniform sampler2D uBoxG2;
void main(){
  ivec2 p = P();
  float eg = texelFetch(uBoxG, p, 0).r;
  float eg2 = texelFetch(uBoxG2, p, 0).r;
  outColor = vec4(max(eg2 - eg*eg, 0.0), 0.0, 0.0, 0.0);
}`;

/** 最大值滤波（自适应背景估计），半径 5（11×11） */
export const MAX_FILTER_FS = HEADER + `
uniform sampler2D uSrc;
void main(){
  ivec2 p = P();
  float m = 0.0;
  for(int dy=-5;dy<=5;dy++) for(int dx=-5;dx<=5;dx++){
    ivec2 q = p + ivec2(dx,dy);
    if(inside(q)) m = max(m, texelFetch(uSrc, q, 0).r);
  }
  outColor = vec4(m, 0.0, 0.0, 0.0);
}`;

/** Sobel 边缘能量，归一化到 0..1 */
export const SOBEL_FS = HEADER + `
uniform sampler2D uSrc;
void main(){
  ivec2 p = P();
  float gx = 0.0, gy = 0.0;
  for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){
    ivec2 q = p + ivec2(dx,dy);
    float v = inside(q) ? texelFetch(uSrc, q, 0).r : 0.0;
    float sx = dx == 0 ? 0.0 : float(dx) * (dx > 0 ? (dy==0?2.0:1.0) : (dy==0?-2.0:-1.0));
    float sy = dy == 0 ? 0.0 : float(dy) * (dy > 0 ? (dx==0?2.0:1.0) : (dx==0?-2.0:-1.0));
    gx += v * sx; gy += v * sy;
  }
  float e = length(vec2(gx,gy)) / 4.0;
  outColor = vec4(clamp(e, 0.0, 1.0), 0.0, 0.0, 0.0);
}`;

/** 自适应前景分割：暗度差为主证据，强边缘仅在伴随一定暗度时补洞，输出 0/255 到 RGBA8 */
export const THRESHOLD_FS = HEADER + `
uniform sampler2D uBg;
uniform sampler2D uGray;
uniform sampler2D uEdge;
uniform float uThresh;
uniform float uEdgeThresh;
void main(){
  ivec2 p = P();
  float bg = texelFetch(uBg, p, 0).r;
  float g = texelFetch(uGray, p, 0).r;
  float e = texelFetch(uEdge, p, 0).r;
  float dark = bg - g;
  float m = ((dark > uThresh) || (e > uEdgeThresh && dark > uThresh * 0.35)) ? 1.0 : 0.0;
  outColor = vec4(m, m, m, 1.0);
}`;

/**
 * 全局阈值分割：归一化灰度高于 uGlobalThresh 即前景（染色结构）。
 * 归一化已做染色不变处理，双峰间固定阈值对染色漂移稳健；
 * 强边缘在有一定灰度时补回轮廓断裂。
 */
export const GLOBAL_THRESHOLD_FS = HEADER + `
uniform sampler2D uGray;
uniform sampler2D uEdge;
uniform float uGlobalThresh;
uniform float uEdgeThresh;
void main(){
  ivec2 p = P();
  float g = texelFetch(uGray, p, 0).r;
  float e = texelFetch(uEdge, p, 0).r;
  float byGray = step(uGlobalThresh, g);
  float byEdge = step(uEdgeThresh, e) * step(uGlobalThresh * 0.55, g);
  float m = clamp(byGray + byEdge, 0.0, 1.0);
  outColor = vec4(m, m, m, 1.0);
}`;

/** 形态学 3×3：uOp=0 腐蚀，1 膨胀；RGBA8 采样归一化到 0..1 */
export const MORPH_FS = HEADER + `
uniform sampler2D uSrc;
uniform int uOp;
void main(){
  ivec2 p = P();
  float v = uOp == 1 ? 0.0 : 1.0;
  for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){
    ivec2 q = p + ivec2(dx,dy);
    float s = inside(q) ? texelFetch(uSrc, q, 0).r : 0.0;
    v = uOp == 1 ? max(v, s) : min(v, s);
  }
  outColor = vec4(v, v, v, 1.0);
}`;

/**
 * 距离变换种子初始化：背景像素作为边界种子（到边界距离=0），
 * 前景像素留空，由 JFA 在前景内传播最近边界，得到前景内部距离变换。
 */
export const JFA_INIT_DIST_FS = HEADER + `
uniform sampler2D uMask;
void main(){
  ivec2 p = P();
  float m = texelFetch(uMask, p, 0).r;
  if(m < 0.5) outColor = vec4(1.0, float(p.x)+0.5, float(p.y)+0.5, 0.0);
  else outColor = vec4(0.0, -1.0, -1.0, 1e9);
}`;

/** JFA 种子初始化（分水岭标记用）：浮点纹理 r=标号(>0)，坐标由像素位置重建 */
export const JFA_INIT_MARKER_FS = HEADER + `
uniform sampler2D uMarkers;
void main(){
  ivec2 p = P();
  float m = texelFetch(uMarkers, p, 0).r;
  if(m > 0.5) outColor = vec4(m, float(p.x)+0.5, float(p.y)+0.5, 0.0);
  else outColor = vec4(0.0, -1.0, -1.0, 1e9);
}`;

/** Jump Flooding 主过程（距离变换）：9 邻域取最近种子 */
export const JFA_STEP_FS = HEADER + `
uniform sampler2D uSrc;
uniform sampler2D uMask;
uniform vec2 uJump;
uniform int uWithMask;
void main(){
  ivec2 p = P();
  vec4 best = texelFetch(uSrc, p, 0);
  vec2 fpos = vec2(p) + 0.5;
  float bestD = best.a;
  for(int oy=-1;oy<=1;oy++) for(int ox=-1;ox<=1;ox++){
    ivec2 q = p + ivec2(round(uJump * vec2(float(ox), float(oy))));
    if(!inside(q)) continue;
    vec4 cand = texelFetch(uSrc, q, 0);
    if(cand.r < 0.5) continue;
    float d = distance(fpos, cand.gb);
    if(d < bestD - 1e-6 || (abs(d-bestD)<1e-6 && cand.r < best.r)){
      bestD = d; best = vec4(cand.rgb, d);
    }
  }
  if(uWithMask == 1 && texelFetch(uMask, p, 0).r < 0.5) {
    outColor = vec4(0.0, 0.0, 0.0, 0.0);
  } else {
    outColor = vec4(best.rgb, bestD);
  }
}`;

/**
 * 分水岭标记传播专用：在 mask 内做最近标号生长。
 * 关键：自身已是种子（r>0）时始终保留，避免大 jump 首步把种子清零；
 * mask 外像素恒为 0，标号不泄漏到背景。
 */
export const WATERSHED_STEP_FS = HEADER + `
uniform sampler2D uSrc;
uniform sampler2D uMask;
uniform vec2 uJump;
void main(){
  ivec2 p = P();
  // RGBA8 纹理采样值归一化到 0..1（前景为 1.0），阈值用 0.5
  float inMask = step(0.5, texelFetch(uMask, p, 0).r);
  vec2 fpos = vec2(p) + 0.5;
  vec4 best = texelFetch(uSrc, p, 0);
  float bestD = best.r > 0.5 ? distance(fpos, best.gb) : 1e9;
  for(int oy=-1;oy<=1;oy++) for(int ox=-1;ox<=1;ox++){
    if(ox==0 && oy==0) continue;
    ivec2 q = p + ivec2(round(uJump * vec2(float(ox), float(oy))));
    if(!inside(q)) continue;
    vec4 cand = texelFetch(uSrc, q, 0);
    if(cand.r < 0.5) continue;
    float d = distance(fpos, cand.gb);
    if(d < bestD - 1e-6 || (abs(d-bestD)<1e-6 && cand.r < best.r)){
      bestD = d; best = vec4(cand.rgb, d);
    }
  }
  vec4 grown = best.r > 0.5 ? vec4(best.rgb, bestD) : vec4(0.0);
  outColor = grown * inMask;
}`;

/** 由 JFA 结果输出距离图（r 通道） */
export const JFA_DISTANCE_FS = HEADER + `
uniform sampler2D uSrc;
void main(){
  vec4 s = texelFetch(uSrc, P(), 0);
  outColor = vec4(s.a, s.r, 0.0, 0.0);
}`;

/**
 * 距离变换传播：背景边界种子（r=1）向前景内部传播最近边界距离。
 * 背景像素保持自身种子；前景像素取 9 邻域中最近的边界种子距离；
 * 最终只读取前景区域的距离通道。
 */
export const DISTANCE_STEP_FS = HEADER + `
uniform sampler2D uSrc;
uniform sampler2D uMask;
uniform vec2 uJump;
void main(){
  ivec2 p = P();
  float inMask = step(0.5, texelFetch(uMask, p, 0).r);
  vec2 fpos = vec2(p) + 0.5;
  vec4 best = texelFetch(uSrc, p, 0);
  float bestD = best.r > 0.5 ? distance(fpos, best.gb) : 1e9;
  for(int oy=-1;oy<=1;oy++) for(int ox=-1;ox<=1;ox++){
    if(ox==0 && oy==0) continue;
    ivec2 q = p + ivec2(round(uJump * vec2(float(ox), float(oy))));
    if(!inside(q)) continue;
    vec4 cand = texelFetch(uSrc, q, 0);
    if(cand.r < 0.5) continue;
    float d = distance(fpos, cand.gb);
    if(d < bestD - 1e-6){ bestD = d; best = vec4(cand.rgb, d); }
  }
  // 背景（inMask=0）保留原种子；前景输出最近边界距离，无种子则 0
  if(inMask < 0.5) {
    outColor = texelFetch(uSrc, p, 0);
  } else {
    outColor = best.r > 0.5 ? vec4(best.rgb, bestD) : vec4(0.0);
  }
}`;
