import {
  BOX_BLUR_FS,
  DISTANCE_STEP_FS,
  GLOBAL_THRESHOLD_FS,
  JFA_DISTANCE_FS,
  JFA_INIT_DIST_FS,
  JFA_INIT_MARKER_FS,
  MAX_FILTER_FS,
  MORPH_FS,
  NORMALIZE_FS,
  SOBEL_FS,
  SQUARE_FS,
  THRESHOLD_FS,
  VARIANCE_FS,
  WATERSHED_STEP_FS,
} from './shaders';

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

interface FboTex {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  internalFormat: number;
  format: number;
  type: number;
}

interface Compiled {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  uniformTypes: Record<string, number>;
}

function isPowerOf2(n: number): boolean {
  return (n & (n - 1)) === 0;
}

/**
 * WebGL2 GPGPU 引擎：管理浮点纹理、FBO ping-pong、
 * Jump Flooding 与逐像素全图着色器调度。所有重计算均在 GPU 完成。
 */
export class GpuEngine {
  readonly gl: WebGL2RenderingContext;
  readonly width: number;
  readonly height: number;
  private quadVao: WebGLVertexArrayObject;
  private programs = new Map<string, Compiled>();
  private pool: FboTex[] = [];
  private activeTextures = new Set<number>();

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    const gl = canvas.getContext('webgl2', {
      preserveDrawingBuffer: false,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('不支持 EXT_color_buffer_float，无法做浮点 GPGPU');
    this.gl = gl;
    this.width = width;
    this.height = height;
    gl.viewport(0, 0, width, height);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('VAO 创建失败');
    this.quadVao = vao;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private compile(fsSource: string): Compiled {
    const gl = this.gl;
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fs);
      throw new Error('片元着色器编译失败: ' + log);
    }
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERT);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error('顶点着色器编译失败: ' + gl.getShaderInfoLog(vs));
    }
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(program));
    }
    gl.deleteShader(fs);
    gl.deleteShader(vs);
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    const uniformTypes: Record<string, number> = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i)!;
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
      uniformTypes[info.name] = info.type;
    }
    return { program, uniforms, uniformTypes };
  }

  private getProgram(name: string, fsSource: string): Compiled {
    let p = this.programs.get(name);
    if (!p) {
      p = this.compile(fsSource);
      this.programs.set(name, p);
    }
    return p;
  }

  private createTexture(
    internalFormat: number,
    format: number,
    type: number,
    data?: ArrayBufferView | null,
  ): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      this.width,
      this.height,
      0,
      format,
      type,
      data ?? null,
    );
    return tex;
  }

  private acquire(kind: 'float' | 'uint8'): FboTex {
    const gl = this.gl;
    const internalFormat = kind === 'float' ? gl.RGBA32F : gl.RGBA8;
    const reusable = this.pool.find((t) => t.internalFormat === internalFormat);
    if (reusable) {
      this.pool = this.pool.filter((t) => t !== reusable);
      return reusable;
    }
    const format = gl.RGBA;
    const type = kind === 'float' ? gl.FLOAT : gl.UNSIGNED_BYTE;
    const tex = this.createTexture(internalFormat, format, type);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('FBO 不完整: 0x' + status.toString(16));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, internalFormat, format, type };
  }

  release(t: FboTex | null | undefined): void {
    if (t) this.pool.push(t);
  }

  private bindTexture(unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this.activeTextures.add(unit);
  }

  private runProgram(
    name: string,
    fs: string,
    target: FboTex,
    inputs: { sampler: string; tex: WebGLTexture; unit: number }[],
    uniforms: Record<string, number | number[]> = {},
  ): void {
    const gl = this.gl;
    const { program, uniforms: ulocs, uniformTypes } = this.getProgram(name, fs);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program);
    gl.uniform2f(ulocs.uSize!, this.width, this.height);
    for (const inp of inputs) {
      this.bindTexture(inp.unit, inp.tex);
      const loc = ulocs[inp.sampler];
      if (loc) gl.uniform1i(loc, inp.unit);
    }
    for (const [k, v] of Object.entries(uniforms)) {
      const loc = ulocs[k];
      if (!loc) continue;
      if (Array.isArray(v)) {
        if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
        else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
      } else {
        // 整型 uniform（uOp/uRadius/uWithMask 等）必须用 uniform1i
        if (uniformTypes[k] === gl.INT || uniformTypes[k] === gl.BOOL) {
          gl.uniform1i(loc, Math.round(v));
        } else {
          gl.uniform1f(loc, v);
        }
      }
    }
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    for (const unit of this.activeTextures) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    this.activeTextures.clear();
  }

  /** 上传任意画布为 RGBA8 输入纹理（尺寸须与引擎一致，外部先缩放到工作分辨率） */
  uploadCanvas(canvas: HTMLCanvasElement): WebGLTexture {
    const gl = this.gl;
    const tex = this.createTexture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    return tex;
  }

  uploadImageData(data: ImageData): WebGLTexture {
    const gl = this.gl;
    const tex = this.createTexture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return tex;
  }

  readFloat(t: FboTex): Float32Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    const out = new Float32Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, out);
    return out;
  }

  readChannel(t: FboTex, channel: 0 | 1 | 2 | 3): Float32Array {
    const full = this.readFloat(t);
    const n = this.width * this.height;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = full[i * 4 + channel];
    return out;
  }

  readMask(t: FboTex): Uint8Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    const raw = new Uint8Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const out = new Uint8Array(this.width * this.height);
    for (let i = 0; i < out.length; i++) out[i] = raw[i * 4] > 127 ? 1 : 0;
    return out;
  }

  readPixelsAt(t: FboTex): Float32Array {
    return this.readFloat(t);
  }

  // ---- 高层全图操作 ----

  normalize(inputTex: WebGLTexture, pLo: [number, number, number], pHi: [number, number, number]): FboTex {
    const out = this.acquire('float');
    this.runProgram('normalize', NORMALIZE_FS, out, [{ sampler: 'uImg', tex: inputTex, unit: 0 }], {
      uPLo: pLo,
      uPHi: pHi,
    });
    return out;
  }

  boxBlur(src: FboTex, dirX: number, dirY: number, radius: number): FboTex {
    const out = this.acquire('float');
    this.runProgram(
      'box',
      BOX_BLUR_FS,
      out,
      [{ sampler: 'uSrc', tex: src.tex, unit: 0 }],
      { uDir: [dirX, dirY], uRadius: radius },
    );
    return out;
  }

  square(src: FboTex): FboTex {
    const out = this.acquire('float');
    this.runProgram('square', SQUARE_FS, out, [{ sampler: 'uSrc', tex: src.tex, unit: 0 }]);
    return out;
  }

  variance(boxG: FboTex, boxG2: FboTex): FboTex {
    const out = this.acquire('float');
    this.runProgram(
      'variance',
      VARIANCE_FS,
      out,
      [
        { sampler: 'uBoxG', tex: boxG.tex, unit: 0 },
        { sampler: 'uBoxG2', tex: boxG2.tex, unit: 1 },
      ],
    );
    return out;
  }

  maxFilter(src: FboTex): FboTex {
    const out = this.acquire('float');
    this.runProgram('maxf', MAX_FILTER_FS, out, [{ sampler: 'uSrc', tex: src.tex, unit: 0 }]);
    return out;
  }

  sobel(src: FboTex): FboTex {
    const out = this.acquire('float');
    this.runProgram('sobel', SOBEL_FS, out, [{ sampler: 'uSrc', tex: src.tex, unit: 0 }]);
    return out;
  }

  threshold(bg: FboTex, gray: FboTex, edge: FboTex, thresh: number, edgeThresh: number): FboTex {
    const out = this.acquire('uint8');
    this.runProgram(
      'thr',
      THRESHOLD_FS,
      out,
      [
        { sampler: 'uBg', tex: bg.tex, unit: 0 },
        { sampler: 'uGray', tex: gray.tex, unit: 1 },
        { sampler: 'uEdge', tex: edge.tex, unit: 2 },
      ],
      { uThresh: thresh, uEdgeThresh: edgeThresh },
    );
    return out;
  }

  /** 全局阈值分割（染色归一化后的双峰阈值），不依赖局部背景估计 */
  globalThreshold(gray: FboTex, edge: FboTex, globalThresh: number, edgeThresh: number): FboTex {
    const out = this.acquire('uint8');
    this.runProgram(
      'gthr',
      GLOBAL_THRESHOLD_FS,
      out,
      [
        { sampler: 'uGray', tex: gray.tex, unit: 0 },
        { sampler: 'uEdge', tex: edge.tex, unit: 1 },
      ],
      { uGlobalThresh: globalThresh, uEdgeThresh: edgeThresh },
    );
    return out;
  }

  morph(src: FboTex, op: 0 | 1): FboTex {
    const out = this.acquire('uint8');
    this.runProgram('morph', MORPH_FS, out, [{ sampler: 'uSrc', tex: src.tex, unit: 0 }], { uOp: op });
    return out;
  }

  /** Jump Flooding 距离变换，输出 r=距离(px), g=最近种子标号(若有) */
  jfaDistance(mask: FboTex): FboTex {
    const gl = this.gl;
    const init = this.acquire('float');
    this.runProgram('jfaInitD', JFA_INIT_DIST_FS, init, [
      { sampler: 'uMask', tex: mask.tex, unit: 0 },
    ]);
    let cur = init;
    const maxSide = Math.max(this.width, this.height);
    let jump = 1;
    while (jump * 2 <= maxSide) jump *= 2;
    let step = 0;
    for (; jump >= 1; jump = Math.floor(jump / 2)) {
      const next = this.acquire('float');
      this.runProgram(
        'distStep' + step++,
        DISTANCE_STEP_FS,
        next,
        [
          { sampler: 'uSrc', tex: cur.tex, unit: 0 },
          { sampler: 'uMask', tex: mask.tex, unit: 1 },
        ],
        { uJump: [jump, jump] },
      );
      this.release(cur);
      cur = next;
    }
    const out = this.acquire('float');
    this.runProgram('jfaDist', JFA_DISTANCE_FS, out, [{ sampler: 'uSrc', tex: cur.tex, unit: 0 }]);
    this.release(cur);
    void gl;
    return out;
  }

  /**
   * 分水岭标记传播：uMarkers(RGBA8: r=标号 1..255, g/b=种子 x,y 0..255 编码不用于坐标)
   * 实际坐标在着色器中由像素位置重建；mask 限定传播范围。
   * 输出 r=标号（背景为 0）。
   */
  jfaWatershed(markers: FboTex, mask: FboTex): FboTex {
    const init = this.acquire('float');
    this.runProgram('jfaInitM', JFA_INIT_MARKER_FS, init, [
      { sampler: 'uMarkers', tex: markers.tex, unit: 0 },
    ]);
    let cur = init;
    const maxSide = Math.max(this.width, this.height);
    let jump = 1;
    while (jump * 2 <= maxSide) jump *= 2;
    let step = 0;
    for (; jump >= 1; jump = Math.floor(jump / 2)) {
      const next = this.acquire('float');
      this.runProgram(
        'wshStep' + step++,
        WATERSHED_STEP_FS,
        next,
        [
          { sampler: 'uSrc', tex: cur.tex, unit: 0 },
          { sampler: 'uMask', tex: mask.tex, unit: 1 },
        ],
        { uJump: [jump, jump] },
      );
      this.release(cur);
      cur = next;
    }
    return cur;
  }

  /** 用 CPU 二值图构建 RGBA8 纹理（白=255） */
  uploadUint8Mask(mask: Uint8Array): FboTex {
    const gl = this.gl;
    const rgba = new Uint8Array(this.width * this.height * 4);
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i] ? 255 : 0;
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    const tex = this.createTexture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
  }

  /** 用 CPU 生成的 Int32 标号图（0=背景）构建浮点标记纹理 */
  uploadMarkerTexture(marker: Int32Array): FboTex {
    const gl = this.gl;
    const rgba = new Float32Array(this.width * this.height * 4);
    for (let i = 0; i < marker.length; i++) {
      rgba[i * 4] = marker[i];
    }
    const tex = this.createTexture(gl.RGBA32F, gl.RGBA, gl.FLOAT, rgba);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const t: FboTex = { fbo, tex, internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT };
    return t;
  }

  destroy(): void {
    const gl = this.gl;
    for (const t of this.pool) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    this.pool = [];
    for (const c of this.programs.values()) gl.deleteProgram(c.program);
    gl.deleteVertexArray(this.quadVao);
  }
}

export function nextPow2(v: number): number {
  return isPowerOf2(v) ? v : Math.pow(2, Math.ceil(Math.log2(v)));
}
