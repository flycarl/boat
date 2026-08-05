import * as THREE from 'three';

export class CameraRig {
  private readonly desiredPosition = new THREE.Vector3();
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

  snapTo(target: THREE.Vector3): void {
    this.desiredPosition.copy(target).add(this.offset);
    this.camera.position.copy(this.desiredPosition);
    this.lookTarget.copy(target).add(new THREE.Vector3(0, 0.12, 0));
    this.camera.lookAt(this.lookTarget);
  }

  update(delta: number, target: THREE.Vector3, lag: number): void {
    this.desiredPosition.copy(target).add(this.offset);
    const factor = 1 - Math.exp(-delta / Math.max(0.001, lag * 0.72));
    this.camera.position.lerp(this.desiredPosition, factor);
    this.lookTarget.copy(target).add(new THREE.Vector3(0, 0.08, 0));
    this.camera.lookAt(this.lookTarget);
  }

  updateOverview(delta: number): void {
    const factor = 1 - Math.exp(-delta / 0.32);
    this.camera.position.lerp(this.overviewPosition, factor);
    this.lookTarget.lerp(this.overviewTarget, factor);
    this.camera.lookAt(this.lookTarget);
  }
}
