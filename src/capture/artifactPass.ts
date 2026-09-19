import * as THREE from 'three';
import { ARTIFACTS_FRAG, ARTIFACTS_VERT } from './shaders/artifacts';
import type { FrameArtifacts } from './imageFormation';

/**
 * Artifact post-process (IMG-005..IMG-012, visual side): a full-screen
 * pass that reads a clean scene target and writes a degraded "captured
 * frame" target. Presentation only — the uniforms come from
 * `frameArtifacts(...).visual` (IMG-003, NFR-002).
 *
 * One shared mesh + material for all cameras (uniforms are set per render).
 */
export class ArtifactPass {
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private scene: THREE.Scene;
  private cam: THREE.OrthographicCamera;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: ARTIFACTS_VERT,
      fragmentShader: ARTIFACTS_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uScene: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uMotionDir: { value: new THREE.Vector2(0, 0) },
        uMotionPx: { value: 0 },
        uMotionSamples: { value: 1 },
        uRollingSkew: { value: 0 },
        uDefocusPx: { value: 0 },
        uCompression: { value: 0 },
        uGlare: { value: 0 },
        uBrightness: { value: 1 },
        uClipFraction: { value: 0 },
        uNoiseAmp: { value: 0 },
        uNoiseSeed: { value: 0 },
        uVignette: { value: 0 },
        uDistortion: { value: 0 },
      },
    });

    const geo = new THREE.BufferGeometry();
    // Fullscreen triangle in NDC (covers the whole viewport, 1 vertex fetch
    // per pixel, no overdraw of the 4th triangle).
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2),
    );
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;

    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** Push the visual params of one frame into the uniforms. */
  setParams(v: FrameArtifacts['visual'], widthPx: number, heightPx: number, timeS: number): void {
    const u = this.mat.uniforms;
    (u.uResolution.value as THREE.Vector2).set(widthPx, heightPx);
    u.uTime.value = timeS;
    (u.uMotionDir.value as THREE.Vector2).set(v.motionDir[0], v.motionDir[1]);
    u.uMotionPx.value = v.motionPx;
    u.uMotionSamples.value = v.motionSamples;
    u.uRollingSkew.value = v.rollingSkew;
    u.uDefocusPx.value = v.defocusPx;
    u.uCompression.value = v.compression;
    u.uGlare.value = v.glare;
    u.uBrightness.value = v.brightness;
    u.uClipFraction.value = v.clipFraction;
    u.uNoiseAmp.value = v.noiseAmp;
    u.uNoiseSeed.value = v.noiseSeed;
    u.uVignette.value = v.vignette;
    u.uDistortion.value = v.distortion;
  }

  /** Read `rtIn`, write the degraded frame to `rtOut`. */
  render(
    gl: THREE.WebGLRenderer,
    rtIn: THREE.WebGLRenderTarget,
    rtOut: THREE.WebGLRenderTarget,
  ): void {
    this.mat.uniforms.uScene.value = rtIn.texture;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(rtOut);
    gl.clear();
    gl.render(this.scene, this.cam);
    gl.setRenderTarget(prev);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
