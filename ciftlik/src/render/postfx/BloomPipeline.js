// Eşikli bloom (PLAN §2: eşik ~0.75, yumuşak): parlaklık çıkarımı → çeyrek çözünürlükte ayrık Gauss →
// son geçişte ekran karışımı + grade + vinyet/gren/letterbox (tek tam ekran geçişi).
import Phaser from 'phaser';
import { GRADE_UNIFORMS, GRADE_GLSL } from './GradePipeline.js';
import { CINE_UNIFORMS, CINE_GLSL, createLook, applyLook } from './CinematicPipeline.js';

const THRESH = `
#define SHADER_NAME CIFTLIK_BLOOM_TH
precision mediump float;
uniform sampler2D uMainSampler;
uniform float uThreshold;
varying vec2 outTexCoord;
void main() {
  vec3 c = texture2D(uMainSampler, outTexCoord).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(uThreshold - 0.12, uThreshold + 0.2, max(l, max(c.r, c.b) * 0.92));
  gl_FragColor = vec4(c * w, 1.0);
}`;

const BLUR = `
#define SHADER_NAME CIFTLIK_BLOOM_BLUR
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2 uDir;
varying vec2 outTexCoord;
void main() {
  vec3 s = texture2D(uMainSampler, outTexCoord).rgb * 0.2270270;
  s += texture2D(uMainSampler, outTexCoord + uDir * 1.3846153).rgb * 0.3162162;
  s += texture2D(uMainSampler, outTexCoord - uDir * 1.3846153).rgb * 0.3162162;
  s += texture2D(uMainSampler, outTexCoord + uDir * 3.2307692).rgb * 0.0702702;
  s += texture2D(uMainSampler, outTexCoord - uDir * 3.2307692).rgb * 0.0702702;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMBINE = `
#define SHADER_NAME CIFTLIK_BLOOM_COMBINE
precision mediump float;
uniform sampler2D uMainSampler;
uniform sampler2D uBloom;
uniform float uStrength;
varying vec2 outTexCoord;
${GRADE_UNIFORMS}
${CINE_UNIFORMS}
${GRADE_GLSL}
${CINE_GLSL}
void main() {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  vec3 b = texture2D(uBloom, outTexCoord).rgb * uStrength;
  vec3 col = 1.0 - (1.0 - c.rgb) * (1.0 - b);
  gl_FragColor = vec4(cinematic(grade(col), outTexCoord), c.a);
}`;

export default class BloomPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game) {
    super({
      game, name: 'CiftlikBloom',
      renderTarget: [{ scale: 1 }, { scale: 0.25 }, { scale: 0.25 }],
      shaders: [{ name: 'Threshold', fragShader: THRESH }, { name: 'Blur', fragShader: BLUR }, { name: 'Combine', fragShader: COMBINE }],
    });
    this.threshold = 0.75; this.strength = 0.85; this.passes = 3; this.look = createLook();
  }

  onDraw(source) {
    const [, a, b] = this.renderTargets;
    const [th, bl, cb] = this.shaders;
    const gl = this.gl;
    this.set1f('uThreshold', this.threshold, th);
    this.bindAndDraw(source, a, true, true, th);
    for (let i = 0; i < this.passes; i++) {
      const r = 1 + i;
      this.set2f('uDir', r / a.width, 0, bl); this.bindAndDraw(a, b, true, true, bl);
      this.set2f('uDir', 0, r / a.height, bl); this.bindAndDraw(b, a, true, true, bl);
    }
    this.set1i('uBloom', 1, cb); this.set1f('uStrength', this.strength, cb);
    applyLook(this, cb, this.look);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, a.texture.webGLTexture);
    gl.activeTexture(gl.TEXTURE0);
    gl.viewport(0, 0, source.width, source.height);
    this.bindAndDraw(source, null, true, true, cb);
  }
}
