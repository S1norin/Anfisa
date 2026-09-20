import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultConfig } from '../domain/config';
import { quatRotate } from '../domain/camera';
import type { AreaScanCameraConfig } from '../domain/types';
import { cameraRigToPerspective } from './cameraRig';

describe('cameraRigToPerspective', () => {
  it('points the THREE camera down the rig +Z optical axis', () => {
    const rig = defaultConfig().cameraRigs[0] as AreaScanCameraConfig;
    const camera = cameraRigToPerspective(rig);
    const renderedForward = camera.getWorldDirection(new THREE.Vector3());
    const domainForward = quatRotate(rig.pose.quaternion, [0, 0, 1]);

    expect(renderedForward.x).toBeCloseTo(domainForward[0], 6);
    expect(renderedForward.y).toBeCloseTo(domainForward[1], 6);
    expect(renderedForward.z).toBeCloseTo(domainForward[2], 6);
  });
});
