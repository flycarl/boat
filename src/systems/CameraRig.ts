import * as THREE from 'three';

export class CameraRig {
  private readonly desiredPosition = new THREE.Vector3();
  private readonly scaledOffset = new THREE.Vector3();
  private readonly framingOffset = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly overviewPosition = new THREE.Vector3(0, 148, 66);
  private readonly overviewTarget = new THREE.Vector3(0, 0, 0);

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly offset = new THREE.Vector3(13.5, 18, 13.5),
  ) {
    this.camera.fov = 46;
    this.camera.updateProjectionMatrix();
  }

  snapTo(target: THREE.Vector3, viewScale = 1): void {
    this.scaledOffset.copy(this.offset).multiplyScalar(viewScale);
    this.desiredPosition.copy(target).add(this.scaledOffset);
    this.camera.position.copy(this.desiredPosition);
    this.camera.fov = this.fovForScale(viewScale);
    this.camera.updateProjectionMatrix();
    this.setGameplayLookTarget(target, viewScale, 0.12);
    this.camera.lookAt(this.lookTarget);
  }

  update(delta: number, target: THREE.Vector3, lag: number, viewScale = 1): void {
    this.scaledOffset.copy(this.offset).multiplyScalar(viewScale);
    this.desiredPosition.copy(target).add(this.scaledOffset);
    const factor = 1 - Math.exp(-delta / Math.max(0.001, lag * 0.72));
    this.camera.position.lerp(this.desiredPosition, factor);
    const nextFov = THREE.MathUtils.lerp(this.camera.fov, this.fovForScale(viewScale), factor);
    if (Math.abs(nextFov - this.camera.fov) > 0.001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    this.setGameplayLookTarget(target, viewScale, 0.08);
    this.camera.lookAt(this.lookTarget);
  }

  updateOverview(delta: number): void {
    const factor = 1 - Math.exp(-delta / 0.32);
    this.camera.position.lerp(this.overviewPosition, factor);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 52, factor);
    this.camera.updateProjectionMatrix();
    this.lookTarget.lerp(this.overviewTarget, factor);
    this.camera.lookAt(this.lookTarget);
  }

  private fovForScale(viewScale: number): number {
    return THREE.MathUtils.clamp(42 + (viewScale - 0.72) * (8 / 0.58), 42, 50);
  }

  private setGameplayLookTarget(target: THREE.Vector3, viewScale: number, height: number): void {
    this.framingOffset.set(-this.scaledOffset.x, 0, -this.scaledOffset.z).normalize().multiplyScalar(2.2 * viewScale);
    this.lookTarget.copy(target).add(this.framingOffset);
    this.lookTarget.y += height;
  }
}
