/**
 * Sensor artifact post-process (IMG-005..IMG-012, visual side).
 *
 * One full-screen pass that degrades a clean scene render into a
 * "captured frame" look. It is PURE PRESENTATION: every uniform comes
 * from `frameArtifacts(...).visual`, so the analytic values the quality
 * model reads are untouched (IMG-003, NFR-002).
 *
 * WebGL2 / GLSL ES 3.0 (three r150+). Order inside the pass:
 *   1. radial lens distortion (uv remap)
 *   2. motion streak  + rolling-shutter row skew
 *   3. defocus / bokeh (small circular blur)
 *   4. compression (8×8 block DCT approximation)
 *   5. glare sheen
 *   6. exposure scale + soft highlight clip
 *   7. vignette
 *   8. shot + read noise (deterministic, seeded)
 */

export const ARTIFACTS_VERT = /* glsl */ `#version 300 es
precision highp float;
in vec2 position;
out vec2 vUv;
void main() {
  // Fullscreen triangle covering NDC.
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const ARTIFACTS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uScene;
uniform vec2  uResolution;
uniform float uTime;

uniform vec2  uMotionDir;      // image-space travel direction
uniform float uMotionPx;       // streak length in pixels
uniform int   uMotionSamples;  // temporal taps (DIRECTIONAL uses 8)
uniform float uRollingSkew;    // fraction of height of the readout wedge

uniform float uDefocusPx;

uniform float uCompression;    // 0..1 (x amplification)
uniform float uGlare;          // 0..1
uniform float uBrightness;
uniform float uClipFraction;

uniform float uNoiseAmp;
uniform float uNoiseSeed;

uniform float uVignette;
uniform float uDistortion;

// ---------------------------------------------------------------------------
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 fetchMotion(vec2 uv, vec2 dirPx, float lengthPx, int taps, float skewRow) {
  if (lengthPx < 0.5 || taps < 2) return texture(uScene, uv).rgb;
  // Per-row rolling offset: rows at the top of the sensor were read first.
  vec2 skew = dirPx * skewRow;
  vec2 stepPx = dirPx / float(taps);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 32; i++) {
    if (i >= taps) break;
    vec2 off = stepPx * (float(i) - 0.5 * float(taps - 1)) + skew;
    vec2 p = uv + off / uResolution;
    acc += texture(uScene, clamp(p, 0.001, 0.999)).rgb;
  }
  return acc / float(taps);
}

vec3 fetchDefocus(vec2 uv, float radiusPx) {
  if (radiusPx < 0.5) return texture(uScene, uv).rgb;
  vec2 px = 1.0 / uResolution;
  // 8-tap circular tap (Poisson-ish disc).
  vec3 acc = texture(uScene, uv).rgb;
  for (int i = 0; i < 8; i++) {
    float a = 6.2831853 * (float(i) / 8.0);
    vec2 off = vec2(cos(a), sin(a)) * radiusPx * px;
    acc += texture(uScene, clamp(uv + off, 0.001, 0.999)).rgb;
  }
  return acc / 9.0;
}

vec3 compressBlock(vec2 uv, float amt) {
  if (amt <= 0.001) return texture(uScene, uv).rgb;
  vec2 block = floor(uv * uResolution) / 8.0;
  vec2 blockUv = (block + 0.5) / (uResolution / 8.0);
  vec3 blockCol = texture(uScene, clamp(blockUv, 0.001, 0.999)).rgb;
  vec3 full = texture(uScene, uv).rgb;
  // Quantize to posterize the flat regions, blend by amount.
  float levels = mix(64.0, 8.0, amt);
  vec3 q = floor(full * levels + 0.5) / levels;
  return mix(full, mix(q, blockCol, amt * 0.5), amt);
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);

  // 1. Radial distortion.
  if (abs(uDistortion) > 0.0001) {
    uv = 0.5 + c * (1.0 + uDistortion * r2);
  }
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // 2. Motion + rolling skew. skewRow ∈ [-0.5, 0.5] across the frame.
  float skewRow = (uv.y - 0.5) * uRollingSkew * 2.0;
  vec3 col = fetchMotion(uv, uMotionDir, uMotionPx, uMotionSamples, skewRow);

  // 3. Defocus.
  col = fetchDefocus(uv, uDefocusPx);

  // 4. Compression.
  col = compressBlock(uv, clamp(uCompression, 0.0, 1.0));

  // 5. Glare: a diagonal sheen, strongest where the specular lobe is.
  if (uGlare > 0.001) {
    float band = smoothstep(0.15, 0.0, abs(uv.x * 0.6 + uv.y * 0.8 - 0.75));
    col += vec3(0.9, 0.95, 1.0) * band * uGlare * 0.8;
  }

  // 6. Exposure + soft highlight clip.
  col *= uBrightness;
  // Soft shoulder: push highlights to clip as clipFraction grows.
  float knee = mix(2.0, 1.0, clamp(uClipFraction, 0.0, 1.0));
  col = 1.0 - exp(-col * knee);

  // 7. Vignette.
  col *= 1.0 - uVignette * r2 * 2.0;

  // 8. Deterministic shot + read noise.
  if (uNoiseAmp > 0.001) {
    vec2 np = floor(uv * uResolution);
    float n = hash21(np + vec2(fract(uNoiseSeed), fract(uNoiseSeed * 1.7)) + floor(uTime * 20.0));
    col += (n - 0.5) * uNoiseAmp;
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
