// Color grading (PLAN §2): sıcaklık, mevsimsel yeşil ton kayması, doygunluk, kontrast, gölge tonu, yumuşak S-eğrisi.
// GradePipeline = tek geçiş (grade + vinyet + gren + letterbox); bloom kapalıyken (low) kullanılır.
import Phaser from 'phaser';
import { CINE_UNIFORMS, CINE_GLSL, createLook, applyLook } from './CinematicPipeline.js';

export const GRADE_UNIFORMS = `
uniform float uSat;
uniform float uContrast;
uniform float uWarmth;
uniform float uHue;
uniform float uExposure;
uniform vec3 uLift;
`;

export const GRADE_GLSL = `
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
vec3 grade(vec3 c) {
  c *= uExposure;
  c *= vec3(1.0 + uWarmth * 0.12, 1.0 + uWarmth * 0.03, 1.0 - uWarmth * 0.12);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = mx - mn;
  float greenness = clamp((c.g - max(c.r, c.b)) / (sat + 0.0001), 0.0, 1.0) * smoothstep(0.03, 0.2, sat);
  c = mix(c, hueRotate(c, uHue), greenness);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  c = clamp(c, 0.0, 1.0);
  c = c * c * (3.0 - 2.0 * c) * 0.3 + c * 0.7;
  c += uLift * (1.0 - smoothstep(0.0, 0.55, l));
  return clamp(c, 0.0, 1.0);
}
`;

const FRAG = `
#define SHADER_NAME CIFTLIK_GRADE_FS
precision mediump float;
uniform sampler2D uMainSampler;
varying vec2 outTexCoord;
${GRADE_UNIFORMS}
${CINE_UNIFORMS}
${GRADE_GLSL}
${CINE_GLSL}
void main() {
  vec4 src = texture2D(uMainSampler, outTexCoord);
  gl_FragColor = vec4(cinematic(grade(src.rgb), outTexCoord), src.a);
}`;

export default class GradePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game) {
    super({ game, name: 'CiftlikGrade', fragShader: FRAG });
    this.look = createLook();
  }
  onDraw(target) {
    applyLook(this, this.currentShader, this.look);
    this.bindAndDraw(target);
  }
}
