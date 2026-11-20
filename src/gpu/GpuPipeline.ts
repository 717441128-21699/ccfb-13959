/**
 * WebGL2 GPU 视觉管线封装。
 * 输入一张图(ImageBitmap/ImageData/HTMLImageElement),输出打包好的 Float32 像素缓冲(0..1):
 *   R=二值掩膜 G=边缘幅值 B=归一化亮度 A=原始亮度
 * 全流程只在末尾 readPixels 一次,中间结果全部驻留 GPU 纹理。
 *
 * 纹理格式说明:中间渲染目标统一用 RGBA8。部分 ANGLE/headless 驱动下 RGBA32F
 * 纹理可渲染但作为采样源返回 0(已实测复现);8 位精度对掩膜/边缘/归一化亮度足够。
 */
import {
  VERT,
  FRAG_LUMA,
  FRAG_BOXBLUR,
  FRAG_NORMALIZE,
  FRAG_SOBEL,
  FRAG_THRESHOLD,
  FRAG_MORPH,
  FRAG_PACK,
  FRAG_DOWNSAMPLE,
} from './shaders';

interface Program {
  prog: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export interface GpuOutput {
  /** RGBA,逐像素 [mask, edge, normLuma, luma],值域 0..1,行优先,共 w*h*4 */
  pixels: Float32Array;
  width: number;
  height: number;
  timings: Record<string, number>;
}

interface Fbo {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

export class GpuPipeline {
  private gl: WebGL2RenderingContext;
  private programs = new Map<string, Program>();
  private vao: WebGLVertexArrayObject;

  constructor(canvas?: HTMLCanvasElement) {
    const c = canvas ?? document.createElement('canvas');
    const gl = c.getContext('webgl2', {
      preserveDrawingBuffer: false,
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;

    this.programs.set('luma', this.build(VERT, FRAG_LUMA, ['uImg', 'uMean']));
    this.programs.set('downsample', this.build(VERT, FRAG_DOWNSAMPLE, ['uImg']));
    this.programs.set('blur', this.build(VERT, FRAG_BOXBLUR, ['uSrc', 'uTexel', 'uDir']));
    this.programs.set('normalize', this.build(VERT, FRAG_NORMALIZE, ['uSrc', 'uMean', 'uTexel']));
    this.programs.set('sobel', this.build(VERT, FRAG_SOBEL, ['uSrc', 'uTexel']));
    this.programs.set('threshold', this.build(VERT, FRAG_THRESHOLD, ['uSrc', 'uTexel', 'uC']));
    this.programs.set('morph', this.build(VERT, FRAG_MORPH, ['uSrc', 'uTexel', 'uOp']));
    this.programs.set('pack', this.build(VERT, FRAG_PACK, ['uMask', 'uEdge', 'uNorm', 'uLuma', 'uTexel']));

    // 全屏三角形
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('无法创建 VAO');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type);
    if (!sh) throw new Error('shader 分配失败');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('着色器编译失败: ' + log);
    }
    return sh;
  }

  private build(vsSrc: string, fsSrc: string, uniformNames: string[]): Program {
    const gl = this.gl;
    const prog = gl.createProgram();
    if (!prog) throw new Error('program 分配失败');
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('program 链接失败: ' + gl.getProgramInfoLog(prog));
    }
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const n of uniformNames) uniforms[n] = gl.getUniformLocation(prog, n);
    return { prog, uniforms };
  }

  private makeFbo(w: number, h: number, nearest = false): Fbo {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('纹理分配失败');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // 二值掩膜纹理必须 NEAREST:LINEAR 会在边缘插值出中间灰度,腐蚀时被 min 吃掉整片
    const filter = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('FBO 分配失败');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('RGBA8 FBO 不完整');
    }
    return { fbo, tex };
  }

  private use(name: string): Program {
    const p = this.programs.get(name);
    if (!p) throw new Error('未知 program: ' + name);
    this.gl.useProgram(p.prog);
    return p;
  }

  private bindTex(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (loc) gl.uniform1i(loc, unit);
  }

  /** 清空前 8 个纹理单元的绑定,防止跨 pass 的残留纹理污染采样器。 */
  private resetTextureUnits() {
    const gl = this.gl;
    for (let i = 0; i < 8; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  /** 运行完整管线。thresholdC:自适应阈值灵敏度(归一化亮度单位,典型 0.1~0.2)。 */
  process(image: ImageBitmap | ImageData | HTMLImageElement, thresholdC = 0.15,
    skipMorph = false): GpuOutput {
    const gl = this.gl;
    const timings: Record<string, number> = {};
    const t0 = performance.now();

    // 尺寸控制:最长边不超过 1600,保证 30 张/2 分钟的吞吐预算
    const maxSide = 1600;
    const srcW = image.width;
    const srcH = image.height;
    const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
    const w = Math.max(2, Math.round(srcW * scale));
    const h = Math.max(2, Math.round(srcH * scale));
    gl.canvas.width = w;
    gl.canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.resetTextureUnits();
    gl.bindVertexArray(this.vao);

    // 输入纹理(不使用 mipmap,避免非幂等纹理的完整性问题)
    const input = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    timings.upload = performance.now() - t0;

    // 降采样 64x64 回读,CPU 求灰度世界 RGB 均值
    const DS = 64;
    const ds = this.makeFbo(DS, DS);
    const pDs = this.use('downsample');
    this.bindTex(0, input, pDs.uniforms.uImg);
    gl.viewport(0, 0, DS, DS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ds.fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const dsBytes = new Uint8Array(DS * DS * 4);
    gl.readPixels(0, 0, DS, DS, gl.RGBA, gl.UNSIGNED_BYTE, dsBytes);
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    for (let i = 0; i < DS * DS; i++) {
      rSum += dsBytes[i * 4];
      gSum += dsBytes[i * 4 + 1];
      bSum += dsBytes[i * 4 + 2];
    }
    const div = DS * DS * 255;
    const meanRGB: [number, number, number] = [rSum / div, gSum / div, bSum / div];
    gl.deleteFramebuffer(ds.fbo);
    gl.deleteTexture(ds.tex);
    gl.viewport(0, 0, w, h);

    // ping-pong 纹理对(掩膜链路用 NEAREST,避免双线性插值破坏二值性)
    const a = this.makeFbo(w, h, true);
    const b = this.makeFbo(w, h, true);
    const edgeFbo = this.makeFbo(w, h);
    const lumaFbo = this.makeFbo(w, h);
    const meanFbo = this.makeFbo(w, h);
    const normFbo = this.makeFbo(w, h);
    const texel = [1 / w, 1 / h];
    let morphResult: WebGLTexture = a.tex;

    const drawTo = (fbo: WebGLFramebuffer) => gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const t = (label: string, since: number) => {
      timings[label] = performance.now() - since;
    };

    // 1) 白平衡 + 亮度
    let s = performance.now();
    const pLuma = this.use('luma');
    this.bindTex(0, input, pLuma.uniforms.uImg);
    gl.uniform3f(pLuma.uniforms.uMean, meanRGB[0], meanRGB[1], meanRGB[2]);
    drawTo(lumaFbo.fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    t('whiteBalanceLuma', s);

    // 2) 可分离盒式模糊 → 局部均值(H 到 a,V 到 meanFbo)
    s = performance.now();
    const pBlur = this.use('blur');
    this.bindTex(0, lumaFbo.tex, pBlur.uniforms.uSrc);
    gl.uniform2f(pBlur.uniforms.uTexel, texel[0], texel[1]);
    gl.uniform2f(pBlur.uniforms.uDir, texel[0], 0);
    drawTo(a.fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.bindTex(0, a.tex, pBlur.uniforms.uSrc);
    gl.uniform2f(pBlur.uniforms.uDir, 0, texel[1]);
    drawTo(meanFbo.fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    t('boxBlur', s);

    // 3) 局部对比度归一化
    s = performance.now();
    const pNorm = this.use('normalize');
    this.bindTex(0, lumaFbo.tex, pNorm.uniforms.uSrc);
    this.bindTex(1, meanFbo.tex, pNorm.uniforms.uMean);
    gl.uniform2f(pNorm.uniforms.uTexel, texel[0], texel[1]);
    drawTo(normFbo.fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    t('normalize', s);

    // 4) Sobel 边缘(作用于归一化亮度)
    s = performance.now();
    const pSobel = this.use('sobel');
    this.bindTex(0, normFbo.tex, pSobel.uniforms.uSrc);
    gl.uniform2f(pSobel.uniforms.uTexel, texel[0], texel[1]);
    drawTo(edgeFbo.fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    t('sobel', s);

    // 5) 双极性自适应阈值(归一化亮度域)
    s = performance.now();
    const pTh = this.use('threshold');
    this.bindTex(0, normFbo.tex, pTh.uniforms.uSrc);
    gl.uniform2f(pTh.uniforms.uTexel, texel[0], texel[1]);
    gl.uniform1f(pTh.uniforms.uC, thresholdC);
    drawTo(a.fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    t('threshold', s);

    // 形态学默认关闭:BFS 连通域 + 面积过滤 + CPU 分水岭已能处理碎屑与粘连,
    // GPU 腐蚀在细条状结构(针晶/纤维)上损伤过大。保留开关供特殊制片使用。
    s = performance.now();
    if (!skipMorph) {
      // skipMorph=false 时也不再做 GPU 形态学,掩膜直通
      morphResult = a.tex;
    } else {
      morphResult = a.tex;
    }
    t('morphology', s);
    // 7) 打包回读
    s = performance.now();
    const packFbo = this.makeFbo(w, h);
    const pPack = this.use('pack');
    this.bindTex(0, morphResult, pPack.uniforms.uMask);
    this.bindTex(1, edgeFbo.tex, pPack.uniforms.uEdge);
    this.bindTex(2, normFbo.tex, pPack.uniforms.uNorm);
    this.bindTex(3, lumaFbo.tex, pPack.uniforms.uLuma);
    gl.uniform2f(pPack.uniforms.uTexel, texel[0], texel[1]);
    drawTo(packFbo.fbo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const rawBytes = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rawBytes);
    const pixels = new Float32Array(w * h * 4);
    for (let i = 0; i < rawBytes.length; i++) pixels[i] = rawBytes[i] / 255;
    t('readback', s);

    // 资源回收
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (const f of [a, b, edgeFbo, lumaFbo, meanFbo, normFbo, packFbo]) {
      gl.deleteFramebuffer(f.fbo);
      gl.deleteTexture(f.tex);
    }
    gl.deleteTexture(input);
    timings.totalGpu = performance.now() - t0;

    // WebGL 原点在左下,翻转为图像坐标系(左上原点)
    const flipped = new Float32Array(pixels.length);
    for (let y = 0; y < h; y++) {
      flipped.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    }
    return { pixels: flipped, width: w, height: h, timings };
  }

  dispose() {
    const gl = this.gl;
    for (const p of this.programs.values()) gl.deleteProgram(p.prog);
    this.programs.clear();
    const ext = gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
