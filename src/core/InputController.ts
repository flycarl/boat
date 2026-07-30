import * as THREE from 'three';

export class InputController {
  private readonly keys = new Set<string>();
  private readonly mouse = new THREE.Vector2();
  private fireDown = false;
  private fireQueued = false;
  private reloadQueued = false;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    this.keys.add(event.code);
    if (event.code === 'KeyJ' || event.code === 'KeyF' || event.code === 'Enter') {
      if (!this.fireDown) this.fireQueued = true;
      this.fireDown = true;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
    if (event.code === 'KeyJ' || event.code === 'KeyF' || event.code === 'Enter') this.fireDown = false;
  };

  private readonly onMouseMove = (event: PointerEvent) => {
    this.mouse.set(event.clientX, event.clientY);
  };

  private readonly onMouseDown = (event: PointerEvent) => {
    if (event.button === 0) {
      this.fireDown = true;
      this.fireQueued = true;
    }
    if (event.button === 2) this.reloadQueued = true;
  };

  private readonly onMouseUp = (event: PointerEvent) => {
    if (event.button === 0) this.fireDown = false;
  };

  private readonly onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    this.reloadQueued = true;
  };

  private readonly onFireTouchDown = (event: PointerEvent) => {
    event.preventDefault();
    this.fireDown = true;
    this.fireQueued = true;
  };

  private readonly onFireTouchUp = (event: PointerEvent) => {
    event.preventDefault();
    this.fireDown = false;
  };

  constructor(
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly fireButton: HTMLElement,
  ) {
    this.mouse.set(window.innerWidth / 2, window.innerHeight / 2);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('pointermove', this.onMouseMove);
    window.addEventListener('pointerdown', this.onMouseDown);
    window.addEventListener('pointerup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
    this.fireButton.addEventListener('pointerdown', this.onFireTouchDown);
    this.fireButton.addEventListener('pointerup', this.onFireTouchUp);
    this.fireButton.addEventListener('pointercancel', this.onFireTouchUp);
    this.fireButton.addEventListener('pointerleave', this.onFireTouchUp);
    this.stick.style.display = 'none';
    this.knob.style.display = 'none';
  }

  getMouse(target: THREE.Vector2): THREE.Vector2 {
    return target.copy(this.mouse);
  }

  readMovement(target: THREE.Vector2): THREE.Vector2 {
    return target.set(0, 0);
  }

  isDashHeld(): boolean {
    return false;
  }

  isFirePressed(): boolean {
    return this.fireDown;
  }

  consumeFire(): boolean {
    const value = this.fireQueued;
    this.fireQueued = false;
    return value;
  }

  consumeReload(): boolean {
    const value = this.reloadQueued || this.keys.has('KeyR');
    this.reloadQueued = false;
    return value;
  }

  consumeRestart(): boolean {
    return this.keys.has('Backspace');
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointermove', this.onMouseMove);
    window.removeEventListener('pointerdown', this.onMouseDown);
    window.removeEventListener('pointerup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
    this.fireButton.removeEventListener('pointerdown', this.onFireTouchDown);
    this.fireButton.removeEventListener('pointerup', this.onFireTouchUp);
    this.fireButton.removeEventListener('pointercancel', this.onFireTouchUp);
    this.fireButton.removeEventListener('pointerleave', this.onFireTouchUp);
  }
}
