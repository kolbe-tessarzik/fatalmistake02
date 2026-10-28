/* Small WebGL renderer. No libraries, network requests, or build step. */
(() => {
  'use strict';
  const multiply = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  };
  const normalize = a => { const n = Math.hypot(...a) || 1; return a.map(v => v / n); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a.reduce((v, x, i) => v + x * b[i], 0);
  const colors = new Map();
  const color = value => {
    if (Array.isArray(value)) return value.length === 4 ? value : [...value, 1];
    if (!colors.has(value)) { const n = parseInt(value.replace('#', ''), 16); colors.set(value, [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1]); }
    return colors.get(value);
  };
  function geometry(kind) {
    const p = [], n = [], uv = [], indices = [];
    const vertex = (x, y, z, nx, ny, nz, u, v) => { p.push(x, y, z); n.push(nx, ny, nz); uv.push(u, v); return p.length / 3 - 1; };
    if (kind === 'sphere' || kind === 'ring') {
      const rows = kind === 'sphere' ? 18 : 12, cols = kind === 'sphere' ? 28 : 48;
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const a = i / cols * Math.PI * 2, b = j / rows * (kind === 'sphere' ? Math.PI : Math.PI * 2);
        if (kind === 'sphere') { const x = Math.sin(b) * Math.cos(a), y = Math.cos(b), z = Math.sin(b) * Math.sin(a); vertex(x, y, z, x, y, z, i / cols, 1 - j / rows); }
        else { const nx = Math.cos(a) * Math.cos(b), ny = Math.sin(b), nz = Math.sin(a) * Math.cos(b); vertex(Math.cos(a) + nx * .12, ny * .12, Math.sin(a) + nz * .12, nx, ny, nz, i / cols, j / rows); }
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + cols + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
    } else if (kind === 'box') {
      const steps = 6, radius = .13;
      for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
        const base = p.length / 3;
        for (let j = 0; j <= steps; j++) for (let i = 0; i <= steps; i++) {
          const a = [0, 0, 0]; a[axis] = sign * .5; a[(axis + 1) % 3] = i / steps - .5; a[(axis + 2) % 3] = j / steps - .5;
          const inner = a.map(v => Math.max(-.5 + radius, Math.min(.5 - radius, v))), normal = normalize(a.map((v, k) => v - inner[k]));
          vertex(...inner.map((v, k) => v + normal[k] * radius), ...normal, i / steps, j / steps);
        }
        for (let j = 0; j < steps; j++) for (let i = 0; i < steps; i++) { const a = base + j * (steps + 1) + i, b = a + steps + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
      }
    } else if (kind === 'cylinder' || kind === 'cone') {
      const count = 32, top = kind === 'cone' ? 0 : 1;
      for (let j = 0; j < 2; j++) for (let i = 0; i <= count; i++) { const a = i / count * Math.PI * 2, r = j ? top : 1, normal = normalize([Math.cos(a), kind === 'cone' ? 1 : 0, Math.sin(a)]); vertex(Math.cos(a) * r, j - .5, Math.sin(a) * r, ...normal, i / count, j); }
      for (let i = 0; i < count; i++) indices.push(i, i + count + 1, i + 1, i + 1, i + count + 1, i + count + 2);
      for (const side of [0, 1]) { const center = vertex(0, side - .5, 0, 0, side ? 1 : -1, 0, .5, .5); const r = side ? top : 1; for (let i = 0; i <= count; i++) { const a = i / count * Math.PI * 2; vertex(Math.cos(a) * r, side - .5, Math.sin(a) * r, 0, side ? 1 : -1, 0, Math.cos(a) * .5 + .5, Math.sin(a) * .5 + .5); if (i) indices.push(center, center + i, center + i + 1); } }
    } else if (kind === 'fan') {
      vertex(0, 0, 0, 0, 1, 0, .5, 0);
      for (let i = 0; i <= 24; i++) { const a = -.65 + i / 24 * 1.3; vertex(Math.sin(a), 0, Math.cos(a), 0, 1, 0, i / 24, 1); if (i) indices.push(0, i, i + 1); }
    } else {
      vertex(-.5, -.5, 0, 0, 0, 1, 0, 0); vertex(.5, -.5, 0, 0, 0, 1, 1, 0); vertex(.5, .5, 0, 0, 0, 1, 1, 1); vertex(-.5, .5, 0, 0, 0, 1, 0, 1); indices.push(0, 1, 2, 0, 2, 3);
    }
    return { p, n, uv, indices };
  }
  class FatalRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL is unavailable. Enable hardware acceleration or use a browser with WebGL support.');
      this.gl = gl; this.eye = [10, 9, 14]; this.vp = new Float32Array(16); this.meshes = {};
      const vs = `attribute vec3 aPosition; attribute vec3 aNormal; attribute vec2 aUV;
        uniform mat4 uModel; uniform mat4 uViewProj; uniform mat3 uNormal;
        varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUV;
        void main(){ vec4 p=uModel*vec4(aPosition,1.0);vWorld=p.xyz;vNormal=normalize(uNormal*aNormal);vUV=aUV;gl_Position=uViewProj*p; }`;
      const fs = `precision mediump float;
        uniform vec4 uColor; uniform vec3 uEye; uniform vec3 uFog; uniform float uFogDistance; uniform float uEmission;
        uniform sampler2D uTexture; uniform float uUseTexture;
        varying vec3 vWorld; varying vec3 vNormal; varying vec2 vUV;
        void main(){vec3 n=normalize(vNormal);vec3 light=normalize(vec3(-0.45,0.85,0.55));float d=max(dot(n,light),0.0);
          float shade=0.57+0.4*smoothstep(-0.1,1.0,d);vec3 base=uColor.rgb;float alpha=uColor.a;
          if(uUseTexture>0.5){vec4 tex=texture2D(uTexture,vUV);base*=tex.rgb;alpha*=tex.a;}
          vec3 viewDir=normalize(uEye-vWorld);float shine=pow(max(dot(n,normalize(light+viewDir)),0.0),28.0)*0.1;
          vec3 lit=base*mix(shade,1.0,uEmission)+shine*(1.0-uEmission);
          float fog=smoothstep(18.0,uFogDistance,length(vWorld-uEye));gl_FragColor=vec4(mix(lit,uFog,fog),alpha);}`;
      const compile = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)); return shader; };
      this.program = gl.createProgram(); gl.attachShader(this.program, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
      gl.useProgram(this.program); this.a = {}; this.u = {};
      for (const name of ['Position', 'Normal', 'UV']) this.a[name] = gl.getAttribLocation(this.program, 'a' + name);
      for (const name of ['Model', 'ViewProj', 'Normal', 'Color', 'Eye', 'Fog', 'FogDistance', 'Emission', 'Texture', 'UseTexture']) this.u[name] = gl.getUniformLocation(this.program, 'u' + name);
      for (const name of ['sphere', 'box', 'cylinder', 'cone', 'ring', 'plane', 'fan']) {
        const data = geometry(name), mesh = { count: data.indices.length };
        for (const [key, values] of [['Position', data.p], ['Normal', data.n], ['UV', data.uv]]) { mesh[key] = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, mesh[key]); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW); }
        mesh.index = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices), gl.STATIC_DRAW); this.meshes[name] = mesh;
      }
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255])); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    texture(canvas) { const tex = this.gl.createTexture(); this.updateTexture(tex, canvas); return tex; }
    updateTexture(tex, canvas) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
    begin(eye, target, fog = '#b6d5d6', fogDistance = 85) {
      const gl = this.gl, dpr = Math.min(window.devicePixelRatio || 1, 1.6), width = Math.round(this.canvas.clientWidth * dpr), height = Math.round(this.canvas.clientHeight * dpr);
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      gl.viewport(0, 0, width, height); const bg = color(fog); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.useProgram(this.program);
      const z = normalize(eye.map((v, i) => v - target[i])), x = normalize(cross([0, 1, 0], z)), y = cross(z, x);
      const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
      const f = 1 / Math.tan(Math.PI / 7), near = .1, far = 260;
      const projection = new Float32Array([f / (width / Math.max(1, height)), 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
      this.vp = multiply(projection, view); this.eye = eye; gl.uniformMatrix4fv(this.u.ViewProj, false, this.vp); gl.uniform3fv(this.u.Eye, eye); gl.uniform3fv(this.u.Fog, bg.slice(0, 3)); gl.uniform1f(this.u.FogDistance, fogDistance); gl.uniform1i(this.u.Texture, 0);
    }
    draw(name, position, scale, tint, rotation = [0, 0, 0], texture = null, emission = 0) {
      const gl = this.gl, mesh = this.meshes[name], [rx, ry, rz] = rotation, a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
      const rot = [c * e, c * f, -d, b * d * e - a * f, b * d * f + a * e, b * c, a * d * e + b * f, a * d * f - b * e, a * c];
      const model = new Float32Array([rot[0] * scale[0], rot[1] * scale[0], rot[2] * scale[0], 0, rot[3] * scale[1], rot[4] * scale[1], rot[5] * scale[1], 0, rot[6] * scale[2], rot[7] * scale[2], rot[8] * scale[2], 0, ...position, 1]);
      const normal = new Float32Array(rot.map((v, i) => v / Math.max(.0001, scale[Math.floor(i / 3)])));
      for (const key of ['Position', 'Normal', 'UV']) { gl.bindBuffer(gl.ARRAY_BUFFER, mesh[key]); gl.enableVertexAttribArray(this.a[key]); gl.vertexAttribPointer(this.a[key], key === 'UV' ? 2 : 3, gl.FLOAT, false, 0, 0); }
      const rgba = color(tint); gl.depthMask(rgba[3] >= 1); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index); gl.uniformMatrix4fv(this.u.Model, false, model); gl.uniformMatrix3fv(this.u.Normal, false, normal); gl.uniform4fv(this.u.Color, rgba); gl.uniform1f(this.u.Emission, emission); gl.uniform1f(this.u.UseTexture, texture ? 1 : 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture || this.white); gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0); gl.depthMask(true);
    }
    project(position) { const m = this.vp, [x, y, z] = position, w = m[3] * x + m[7] * y + m[11] * z + m[15]; if (w <= 0) return null; const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w; if (Math.abs(nx) > 1.2 || Math.abs(ny) > 1.2) return null; return [(nx * .5 + .5) * this.canvas.clientWidth, (-ny * .5 + .5) * this.canvas.clientHeight]; }
  }
  window.FatalRenderer = FatalRenderer;
})();
