import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig } from '../systems/CameraRig';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud, type HudState } from '../systems/Hud';

const SEA = { halfWidth: 38, halfDepth: 27 };
const UPGRADE_ISLAND = new THREE.Vector3(-27, 0, -17);
const UPGRADE_DOCK = new THREE.Vector3(-21.2, 0, -17);
const MAX_START_AMMO = 10;
const ISLAND_COLLIDERS = [
  { center: UPGRADE_ISLAND, radius: 5.7, dock: UPGRADE_DOCK, dockRadius: 2.35 },
  { center: new THREE.Vector3(24, 0, 15), radius: 4.2 },
  { center: new THREE.Vector3(-22, 0, 17), radius: 3.25 },
  { center: new THREE.Vector3(27, 0, -12), radius: 3.0 },
];

type Ball = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; owner: 'player' | 'enemy' | 'ally'; damage: number; source: THREE.Group };
type Loot = { group: THREE.Group; kind: 'gold' | 'med'; value: number; active: boolean; bob: number };
type ShipAi = { group: THREE.Group; velocity: THREE.Vector3; hp: number; maxHp: number; cooldown: number; collideCooldown: number; seed: number; rank: number; coins: number; levelTimer: number; name: string };
type Ally = { group: THREE.Group; velocity: THREE.Vector3; cooldown: number; offset: THREE.Vector3 };
type Castaway = { group: THREE.Group; rescued: boolean; cost: number };
type FloatingText = { element: HTMLElement; position: THREE.Vector3; life: number; maxLife: number; lift: number };

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 140);
  private readonly raycaster = new THREE.Raycaster();
  private readonly seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly mouse = new THREE.Vector2();
  private readonly mouseWorld = new THREE.Vector3();
  private readonly input: InputController;
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly loop = new Loop((delta, elapsed) => this.update(delta, elapsed), () => this.render());
  private readonly tuning: DebugTuning = { speed: 5.4, dashMultiplier: 1, acceleration: 3.2, cameraLag: 0.13, exposure: 1.08, maxDpr: 1.75 };
  private readonly debugTools: DebugTools;
  private readonly player = this.createShip('#7d4d28', '#ded3b5', '#e54b39', 'raft');
  private readonly playerVelocity = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly balls: Ball[] = [];
  private readonly enemies: ShipAi[] = [];
  private readonly loot: Loot[] = [];
  private readonly allies: Ally[] = [];
  private readonly castaways: Castaway[] = [];
  private readonly vfx: THREE.Group[] = [];
  private readonly routeLine: THREE.Line;
  private readonly islandMarker: THREE.Mesh;
  private readonly dockMarker: THREE.Mesh;
  private readonly nameplates = this.getElement('#nameplates');
  private readonly floatingTextsLayer = this.getElement('#floating-texts');
  private readonly mapEnemies = this.getElement('#map-enemies');
  private flagColor = '#e54b39';
  private frame = 0;
  private coins = 0;
  private kills = 0;
  private wave = 1;
  private hp = 85;
  private cannonLevel = 1;
  private hullLevel = 1;
  private speedLevel = 1;
  private ammo = MAX_START_AMMO;
  private maxAmmo = MAX_START_AMMO;
  private reloading = false;
  private reloadTimer = 0;
  private cooldown = 0;
  private spawnTimer = 0;
  private elapsed = 0;
  private paused = false;
  private gameOver = false;
  private upgradeOpen = false;
  private dockCooldown = 0;
  private wakeTimer = 0;
  private playerCollideCooldown = 0;
  private readonly floatingTexts: FloatingText[] = [];

  private playerShipRadius(): number {
    return 1.0 + Math.min(12, this.hullLevel) * 0.16;
  }

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = this.tuning.exposure;
    this.input = new InputController(this.getElement('#touch-stick'), this.getElement('#touch-knob'), this.getElement('#dash-button'));
    this.debugTools = new DebugTools(this.tuning, () => resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr));
    this.routeLine = this.createRouteLine();
    this.islandMarker = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.32, 72), new THREE.MeshBasicMaterial({ color: '#2cff75', transparent: true, opacity: 0.9 }));
    this.islandMarker.rotation.x = -Math.PI / 2;
    this.islandMarker.position.copy(UPGRADE_ISLAND).setY(0.08);
    this.dockMarker = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.08, 48), new THREE.MeshBasicMaterial({ color: '#f8d66d', transparent: true, opacity: 0.95 }));
    this.dockMarker.rotation.x = -Math.PI / 2;
    this.dockMarker.position.copy(UPGRADE_DOCK).setY(0.11);
    window.addEventListener('keydown', this.onKeyDown);
    this.getElement('#flag-menu').addEventListener('click', this.onFlagClick);
    this.getElement('#resume-button').addEventListener('click', () => { this.paused = false; });
    this.getElement('#restart-button').addEventListener('click', () => this.restart());
    this.getElement('#close-upgrade').addEventListener('click', () => this.leaveDock());
    this.getElement('#upgrade-cannon').addEventListener('click', () => this.tryUpgrade('cannon'));
    this.getElement('#upgrade-hull').addEventListener('click', () => this.tryUpgrade('hull'));
    this.getElement('#upgrade-speed').addEventListener('click', () => this.tryUpgrade('speed'));
    this.createScene();
    this.restart();
  }

  start(): void { this.loop.start(); }

  dispose(): void {
    this.loop.stop();
    window.removeEventListener('keydown', this.onKeyDown);
    this.input.dispose();
    this.audio.dispose();
    this.debugTools.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Escape') {
      if (this.upgradeOpen) {
        this.leaveDock();
      } else {
        this.paused = !this.paused;
      }
    }
    if (event.code === 'Backspace') this.restart();
    if (event.code === 'Digit1') this.tryUpgrade('cannon');
    if (event.code === 'Digit2') this.tryUpgrade('hull');
    if (event.code === 'Digit3') this.tryUpgrade('speed');
  };

  private readonly onFlagClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-flag]');
    if (!button) return;
    this.flagColor = button.dataset.flag ?? this.flagColor;
    this.getElement('#flag-menu').querySelectorAll('button').forEach((item) => item.classList.toggle('selected', item === button));
    for (const ship of [this.player, ...this.allies.map((ally) => ally.group)]) this.paintFlag(ship, this.flagColor);
  };

  private update(deltaRaw: number, elapsedRaw: number): void {
    const delta = Math.min(deltaRaw, 0.05);
    this.frame += 1;
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.updateMouseWorld();
    if (!this.paused && !this.upgradeOpen && !this.gameOver) {
      this.elapsed += delta;
      this.dockCooldown = Math.max(0, this.dockCooldown - delta);
      if (this.input.consumeReload()) this.startReload();
      this.updatePlayer(delta, elapsedRaw);
      this.updateAllies(delta, elapsedRaw);
      this.updateEnemies(delta, elapsedRaw);
      this.updateShipCollisions(delta);
      this.updateBalls(delta);
      this.updateLoot(delta, elapsedRaw);
      this.updateCastaways();
      this.updateVfx(delta);
      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0 && this.enemies.length < 8 + Math.min(this.wave, 6)) { this.spawnEnemy(); this.spawnTimer = Math.max(1.4, 4.2 - this.wave * 0.24); }
      if (this.kills >= this.wave * 4) this.wave += 1;
    }
    this.updateFloatingTexts(delta);
    this.updateGuidance();
    this.updateNameplates();
    this.nameplates.classList.toggle('hidden', this.paused || this.gameOver || this.upgradeOpen);
    this.updateUpgradeOverlay();
    this.cameraRig.update(delta, this.player.position, this.tuning.cameraLag);
    this.hud.update(this.getHudState());
    this.publishDiagnostics();
  }

  private render(): void { this.renderer.render(this.scene, this.camera); }

  private restart(): void {
    this.clearDynamic();
    this.player.position.set(0, 0, 0);
    this.player.scale.setScalar(0.82);
    this.playerVelocity.set(0, 0, 0);
    this.coins = 0; this.kills = 0; this.wave = 1; this.hp = this.maxHp();
    this.cannonLevel = 1; this.hullLevel = 1; this.speedLevel = 1;
    this.maxAmmo = MAX_START_AMMO; this.ammo = this.maxAmmo; this.reloading = false; this.reloadTimer = 0;
    this.cooldown = 0; this.dockCooldown = 0; this.elapsed = 0; this.paused = false; this.upgradeOpen = false; this.gameOver = false; this.spawnTimer = 0.2;
    this.paintFlag(this.player, this.flagColor);
    this.applyShipUpgradeVisual(this.player, this.hullLevel);
    this.getElement('#flag-menu').querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.classList.toggle('selected', button.dataset.flag === this.flagColor));
    for (let i = 0; i < 14; i += 1) this.spawnLoot('gold');
    for (let i = 0; i < 6; i += 1) this.spawnLoot('med');
    for (let i = 0; i < 7; i += 1) this.spawnEnemy();
    this.createCastaways();
    this.cameraRig.snapTo(this.player.position);
  }

  private createScene(): void {
    this.scene.background = new THREE.Color('#8fe7ff');
    this.scene.fog = new THREE.Fog('#8fe7ff', 46, 104);
    this.scene.add(new THREE.HemisphereLight('#fff8db', '#16a6c8', 2.05));
    const sun = new THREE.DirectionalLight('#fff1b5', 2.75);
    sun.position.set(-16, 24, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -44; sun.shadow.camera.right = 44; sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
    this.scene.add(sun, this.createOcean(), this.createWorldProps(), this.routeLine, this.islandMarker, this.dockMarker, this.player);
  }

  private updateMouseWorld(): void {
    this.input.getMouse(this.mouse);
    const crosshair = this.getElement('#crosshair');
    crosshair.style.left = `${this.mouse.x}px`;
    crosshair.style.top = `${this.mouse.y}px`;
    this.mouse.x = (this.mouse.x / Math.max(1, window.innerWidth)) * 2 - 1;
    this.mouse.y = -(this.mouse.y / Math.max(1, window.innerHeight)) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    this.raycaster.ray.intersectPlane(this.seaPlane, this.mouseWorld);
  }

  private updatePlayer(delta: number, elapsedRaw: number): void {
    const toMouse = this.mouseWorld.clone().sub(this.player.position); toMouse.y = 0;
    if (toMouse.lengthSq() > 0.2) this.player.rotation.y = Math.atan2(-toMouse.x, -toMouse.z);
    this.forward.copy(toMouse.lengthSq() > 0.2 ? toMouse.normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(this.player.quaternion));
    const speed = this.tuning.speed + (this.speedLevel - 1) * 0.95;
    this.playerVelocity.lerp(this.forward.clone().multiplyScalar(speed), 1 - Math.exp(-this.tuning.acceleration * delta));
    this.player.position.addScaledVector(this.playerVelocity, delta);
    this.clampToSea(this.player.position, 1.8);
    this.resolveIslandCollision(this.player.position, this.player.scale.x * 1.0);
    if (this.dockCooldown <= 0 && this.player.position.distanceTo(UPGRADE_DOCK) < 1.25 + this.playerShipRadius() && this.playerVelocity.length() < speed + 0.5) {
      this.upgradeOpen = true;
      this.paused = false;
    }
    this.player.position.y = Math.sin(elapsedRaw * 3.4) * 0.12;
    this.wakeTimer -= delta;
    if (this.playerVelocity.lengthSq() > 2.2 && this.wakeTimer <= 0) {
      this.createWake(this.player, this.playerShipRadius());
      this.wakeTimer = 0.12;
    }
    this.player.rotation.z = THREE.MathUtils.lerp(this.player.rotation.z, 0, 1 - Math.exp(-8 * delta));
    this.cooldown -= delta;
    if (this.reloading) { this.reloadTimer -= delta; if (this.reloadTimer <= 0) { this.reloading = false; this.ammo = this.maxAmmo; this.audio.upgrade(); } }
    if (this.input.consumeFire() && this.cooldown <= 0) this.playerFire();
  }

  private updateAllies(delta: number, elapsedRaw: number): void {
    this.allies.forEach((ally, index) => {
      const follow = this.player.position.clone().add(ally.offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotation.y));
      ally.velocity.lerp(follow.sub(ally.group.position).multiplyScalar(1.6), 1 - Math.exp(-2.4 * delta));
      ally.group.position.addScaledVector(ally.velocity, delta);
      ally.group.rotation.y = this.player.rotation.y;
      ally.group.position.y = Math.sin(elapsedRaw * 3 + index) * 0.1;
      ally.cooldown -= delta;
      const target = this.enemies.find((enemy) => enemy.group.position.distanceTo(ally.group.position) < 15);
      if (target && ally.cooldown <= 0) {
        this.fireAt(ally.group, target.group.position, 'ally', 7 + this.cannonLevel * 2, 12, '#1a1714');
        ally.cooldown = 1.8;
      }
    });
  }

  private updateEnemies(delta: number, elapsedRaw: number): void {
    for (const enemy of this.enemies) {
      enemy.collideCooldown = Math.max(0, enemy.collideCooldown - delta);
      enemy.coins += delta * (1.1 + enemy.rank * 0.22);
      enemy.levelTimer -= delta;
      if ((enemy.coins >= 22 + enemy.rank * 10 || enemy.levelTimer <= 0) && this.canEnemyUpgrade(enemy)) this.upgradeEnemy(enemy);
      const target = this.findAiTarget(enemy);
      const toTarget = target.position.clone().sub(enemy.group.position);
      const distance = toTarget.length();
      const targetThreat = this.getTargetThreat(target);
      const wantsHiddenUpgrade = enemy.coins >= 22 + enemy.rank * 10 || enemy.levelTimer <= 0;
      const shouldFlee = enemy.hp / enemy.maxHp < 0.28 || (targetThreat > enemy.rank + 3 && enemy.rank < 8) || (wantsHiddenUpgrade && !this.canEnemyUpgrade(enemy));
      const desired = shouldFlee
        ? enemy.group.position.clone().sub(target.position).setY(0).normalize().multiplyScalar(5.2 + enemy.rank * 0.25)
        : toTarget.normalize().multiplyScalar(distance > 9 ? 4.1 + enemy.rank * 0.35 : 1.8);
      desired.add(this.getSeparationForce(enemy).multiplyScalar(2.6));
      desired.x += Math.sin(elapsedRaw * 0.75 + enemy.seed) * 1.5;
      desired.z += Math.cos(elapsedRaw * 0.65 + enemy.seed) * 1.5;
      enemy.velocity.lerp(desired, 1 - Math.exp(-1.4 * delta));
      enemy.group.position.addScaledVector(enemy.velocity, delta);
      this.clampToSea(enemy.group.position, 1.8);
      this.resolveIslandCollision(enemy.group.position, 1.1 * enemy.group.scale.x);
      if (enemy.velocity.lengthSq() > 0.01) enemy.group.rotation.y = Math.atan2(-enemy.velocity.x, -enemy.velocity.z);
      enemy.group.position.y = Math.sin(elapsedRaw * 3 + enemy.seed) * 0.12;
      if (enemy.velocity.lengthSq() > 4 && Math.sin(elapsedRaw * 8 + enemy.seed) > 0.82) this.createWake(enemy.group, 0.9 + enemy.rank * 0.08);
      enemy.cooldown -= delta;
      const attackRange = target === this.player ? 22 : 17;
      if (!shouldFlee && distance < attackRange && enemy.cooldown <= 0) { this.fireAt(enemy.group, target.position, 'enemy', 10 + enemy.rank * 3, 11.5, '#251414'); enemy.cooldown = 2.2 + Math.random() * 0.7; }
    }
  }

  private canEnemyUpgrade(enemy: ShipAi): boolean {
    return enemy.group.position.distanceTo(this.player.position) > 31;
  }

  private updateShipCollisions(delta: number): void {
    this.playerCollideCooldown = Math.max(0, this.playerCollideCooldown - delta);
    for (const enemy of this.enemies) {
      const minDistance = this.playerShipRadius() + 0.75 * enemy.group.scale.x;
      const offset = enemy.group.position.clone().sub(this.player.position).setY(0);
      const distance = offset.length();
      if (distance > 0.001 && distance < minDistance) {
        const normal = offset.normalize();
        const push = (minDistance - distance) * 0.55 + 0.18;
        enemy.group.position.addScaledVector(normal, push);
        this.player.position.addScaledVector(normal, -push * 0.65);
        enemy.velocity.addScaledVector(normal, 4.4);
        this.playerVelocity.addScaledVector(normal, -3.4);
        if (this.playerCollideCooldown <= 0 && enemy.collideCooldown <= 0) {
          this.hp -= 10;
          enemy.hp -= 10;
          this.playerCollideCooldown = 0.55;
          enemy.collideCooldown = 0.55;
          this.spawnDamageText(this.player.position, 10, 'player');
          this.spawnDamageText(enemy.group.position, 10, 'enemy');
          this.makeSplash(this.player.position.clone().lerp(enemy.group.position, 0.5), '#ffffff', 0.45);
          this.audio.hit();
          if (this.hp <= 0) this.gameOver = true;
          if (enemy.hp <= 0) this.sinkEnemy(enemy);
        }
      }
    }

    for (let i = 0; i < this.enemies.length; i += 1) {
      for (let j = i + 1; j < this.enemies.length; j += 1) {
        const a = this.enemies[i];
        const b = this.enemies[j];
        const minDistance = 0.82 * (a.group.scale.x + b.group.scale.x);
        const offset = b.group.position.clone().sub(a.group.position).setY(0);
        const distance = offset.length();
        if (distance <= 0.001 || distance >= minDistance) continue;
        const normal = offset.normalize();
        const push = (minDistance - distance) * 0.5 + 0.12;
        a.group.position.addScaledVector(normal, -push);
        b.group.position.addScaledVector(normal, push);
        a.velocity.addScaledVector(normal, -3.2);
        b.velocity.addScaledVector(normal, 3.2);
        if (a.collideCooldown <= 0 && b.collideCooldown <= 0) {
          a.hp -= 10;
          b.hp -= 10;
          a.collideCooldown = 0.55;
          b.collideCooldown = 0.55;
          this.spawnDamageText(a.group.position, 10, 'enemy');
          this.spawnDamageText(b.group.position, 10, 'enemy');
          this.makeSplash(a.group.position.clone().lerp(b.group.position, 0.5), '#ffffff', 0.42);
          if (a.hp <= 0) this.sinkEnemy(a, false);
          if (b.hp <= 0 && this.enemies.includes(b)) this.sinkEnemy(b, false);
        }
      }
    }
  }

  private getTargetThreat(target: THREE.Group): number {
    if (target === this.player) return this.cannonLevel + this.hullLevel;
    const enemy = this.enemies.find((candidate) => candidate.group === target);
    if (enemy) return enemy.rank;
    return 1;
  }

  private getSeparationForce(enemy: ShipAi): THREE.Vector3 {
    const force = new THREE.Vector3();
    for (const other of this.enemies) {
      if (other === enemy) continue;
      const offset = enemy.group.position.clone().sub(other.group.position).setY(0);
      const distance = offset.length();
      if (distance > 0.001 && distance < 5.2) force.add(offset.normalize().multiplyScalar((5.2 - distance) / 5.2));
    }
    const playerOffset = enemy.group.position.clone().sub(this.player.position).setY(0);
    const playerDistance = playerOffset.length();
    if (playerDistance > 0.001 && playerDistance < 2.6) force.add(playerOffset.normalize().multiplyScalar((2.6 - playerDistance) / 2.6));
    return force;
  }

  private findAiTarget(enemy: ShipAi): THREE.Group {
    const playerDistance = enemy.group.position.distanceTo(this.player.position);
    const healthyEnough = enemy.hp / enemy.maxHp > 0.42;
    const notTryingToUpgrade = !(enemy.coins >= 22 + enemy.rank * 10 || enemy.levelTimer <= 0);
    if (playerDistance < 24 && healthyEnough && notTryingToUpgrade) return this.player;

    const candidates = [
      this.player,
      ...this.allies.map((ally) => ally.group),
      ...this.enemies.filter((other) => other !== enemy).map((other) => other.group),
    ];
    let best = candidates[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const distance = candidate.position.distanceTo(enemy.group.position);
      const preference = candidate === this.player ? -9 : Math.random() * 4.5;
      const score = distance + preference;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  private upgradeEnemy(enemy: ShipAi): void {
    enemy.rank = Math.min(12, enemy.rank + 1);
    enemy.coins = 0;
    enemy.levelTimer = 9 + Math.random() * 9;
    enemy.maxHp += 22;
    enemy.hp = enemy.maxHp;
    enemy.group.scale.setScalar(0.82 + enemy.rank * 0.08);
    this.applyShipUpgradeVisual(enemy.group, enemy.rank);
    this.makeSplash(enemy.group.position, '#7ee9ff', 0.85);
  }

  private updateBalls(delta: number): void {
    for (let i = this.balls.length - 1; i >= 0; i -= 1) {
      const ball = this.balls[i];
      ball.life -= delta; ball.mesh.position.addScaledVector(ball.velocity, delta); ball.mesh.position.y = 0.55 + Math.sin((1 - ball.life) * Math.PI) * 0.85;
      if (ball.owner !== 'enemy') {
        const hit = this.enemies.find((enemy) => ball.mesh.position.distanceTo(enemy.group.position) < 1.35 * enemy.group.scale.x);
        if (hit) { hit.hp -= ball.damage; this.spawnDamageText(hit.group.position, ball.damage, 'enemy'); this.makeSplash(ball.mesh.position, '#f8d66d'); this.removeBall(i); if (hit.hp <= 0) this.sinkEnemy(hit); continue; }
      } else {
        const enemyHit = this.enemies.find((enemy) => enemy.group !== ball.source && ball.mesh.position.distanceTo(enemy.group.position) < 1.35 * enemy.group.scale.x);
        if (enemyHit) { enemyHit.hp -= ball.damage; this.spawnDamageText(enemyHit.group.position, ball.damage, 'enemy'); this.makeSplash(ball.mesh.position, '#ffdd8a'); this.removeBall(i); if (enemyHit.hp <= 0) this.sinkEnemy(enemyHit, false); continue; }
        if (ball.mesh.position.distanceTo(this.player.position) < 1.35 * this.player.scale.x) {
          this.hp -= ball.damage; this.audio.hit(); this.spawnDamageText(this.player.position, ball.damage, 'player'); this.makeSplash(this.player.position, '#e54b39'); this.removeBall(i); if (this.hp <= 0) this.gameOver = true; continue;
        }
      }
      if (ball.life <= 0 || Math.abs(ball.mesh.position.x) > SEA.halfWidth + 5 || Math.abs(ball.mesh.position.z) > SEA.halfDepth + 5) this.removeBall(i);
    }
  }

  private updateLoot(delta: number, elapsedRaw: number): void {
    for (const item of this.loot) {
      if (!item.active) continue;
      item.group.rotation.y += delta * 0.65; item.group.position.y = 0.38 + Math.sin(elapsedRaw * 2 + item.bob) * 0.1;
      for (const enemy of this.enemies) {
        if (!item.active) break;
        if (item.group.position.distanceTo(enemy.group.position) < 1.3 * enemy.group.scale.x) {
          item.active = false;
          item.group.visible = false;
          if (item.kind === 'gold') enemy.coins += item.value;
          else enemy.hp = Math.min(enemy.maxHp, enemy.hp + item.value);
          this.makeSplash(item.group.position, item.kind === 'gold' ? '#f8d66d' : '#4dff88', 0.45);
        }
      }
      if (!item.active) continue;
      if (item.group.position.distanceTo(this.player.position) < 1.35) {
        item.active = false; item.group.visible = false;
        if (item.kind === 'gold') { this.coins += item.value; this.audio.pickup(item.value); this.hud.flashPickup(); }
        else { this.hp = Math.min(this.maxHp(), this.hp + item.value); this.audio.upgrade(); }
      }
    }
    if (this.loot.filter((item) => item.active && item.kind === 'gold').length < 6) this.spawnLoot('gold');
    if (this.loot.filter((item) => item.active && item.kind === 'med').length < 3) this.spawnLoot('med');
  }

  private updateCastaways(): void {
    for (const castaway of this.castaways) {
      if (castaway.rescued) continue;
      castaway.group.lookAt(this.player.position.x, castaway.group.position.y, this.player.position.z);
      if (this.coins >= castaway.cost && castaway.group.position.distanceTo(this.player.position) < 3.2) {
        this.coins -= castaway.cost; castaway.rescued = true; castaway.group.visible = false; this.addAlly(); this.audio.upgrade();
      }
    }
  }

  private playerFire(): void {
    if (this.reloading || this.ammo <= 0) { this.startReload(); return; }
    const mouseDirection = this.mouseWorld.clone().sub(this.player.position).setY(0);
    if (mouseDirection.lengthSq() < 0.1) mouseDirection.set(0, 0, -1).applyQuaternion(this.player.quaternion);
    this.fireInDirection(this.player, mouseDirection.normalize(), 'player', 18 + this.cannonLevel * 8, 17 + this.cannonLevel, '#020202');
    this.ammo -= 1; this.cooldown = Math.max(0.3, 0.72 - this.cannonLevel * 0.07); this.audio.cannon();
  }

  private startReload(): void {
    if (this.reloading || this.ammo === this.maxAmmo) return;
    this.reloading = true; this.reloadTimer = Math.max(0.75, 2.1 - this.cannonLevel * 0.12); this.audio.hit();
  }

  private fireAt(ship: THREE.Group, target: THREE.Vector3, owner: Ball['owner'], damage: number, speed: number, color: string): void {
    const dir = target.clone().sub(ship.position); dir.y = 0; if (dir.lengthSq() < 0.1) dir.set(0, 0, -1).applyQuaternion(ship.quaternion); dir.normalize();
    this.fireInDirection(ship, dir, owner, damage, speed, color);
  }

  private fireInDirection(ship: THREE.Group, direction: THREE.Vector3, owner: Ball['owner'], damage: number, speed: number, color: string): void {
    const dir = direction.clone().setY(0).normalize();
    const start = ship.position.clone().add(dir.clone().multiplyScalar(1.15 * ship.scale.x));
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.72 }));
    mesh.castShadow = true; mesh.position.copy(start); this.scene.add(mesh);
    this.balls.push({ mesh, velocity: dir.multiplyScalar(speed), life: 1.55, owner, damage, source: ship });
    this.makeMuzzlePuff(start, owner === 'enemy' ? '#ff705c' : '#fff1b5');
  }

  private leaveDock(): void {
    this.upgradeOpen = false;
    this.paused = false;
    this.dockCooldown = 1.1;
    const push = this.player.position.clone().sub(UPGRADE_DOCK).setY(0);
    if (push.lengthSq() < 0.01) push.set(1, 0, 0);
    push.normalize();
    this.player.position.copy(UPGRADE_DOCK).add(push.clone().multiplyScalar(1.8 + this.playerShipRadius()));
    this.playerVelocity.copy(push.multiplyScalar(2.2));
  }

  private tryUpgrade(kind: 'cannon' | 'hull' | 'speed'): void {
    if (this.player.position.distanceTo(UPGRADE_DOCK) > 1.55 + this.playerShipRadius()) return;
    const costs = { cannon: this.cannonLevel * 28, hull: this.hullLevel * 30, speed: this.speedLevel * 24 };
    if (kind === 'hull' && this.hullLevel >= 12) return;
    if (this.coins < costs[kind] || this.gameOver) return;
    this.coins -= costs[kind];
    if (kind === 'cannon') { this.cannonLevel += 1; this.maxAmmo += 2; this.ammo = this.maxAmmo; }
    if (kind === 'hull') { this.hullLevel = Math.min(12, this.hullLevel + 1); this.hp = this.maxHp(); }
    if (kind === 'speed') this.speedLevel += 1;
    this.resizeFleet(); this.audio.upgrade();
  }

  private maxHp(): number { return 85 + (this.hullLevel - 1) * 40; }
  private minUpgradeCost(): number { return Math.min(this.cannonLevel * 28, this.hullLevel * 30, this.speedLevel * 24); }

  private resizeFleet(): void {
    const scale = 0.78 + this.hullLevel * 0.13 + this.cannonLevel * 0.04;
    this.player.scale.setScalar(scale);
    this.applyShipUpgradeVisual(this.player, this.hullLevel);
    this.allies.forEach((ally) => {
      ally.group.scale.setScalar(0.62 + this.hullLevel * 0.05);
      this.applyShipUpgradeVisual(ally.group, Math.max(1, Math.floor(this.hullLevel / 2)));
    });
  }

  private sinkEnemy(enemy: ShipAi, rewardPlayer = true): void {
    this.enemies.splice(this.enemies.indexOf(enemy), 1); this.scene.remove(enemy.group);
    if (rewardPlayer) { this.kills += 1; this.coins += 18 + enemy.rank * 9; }
    for (let i = 0; i < 2; i += 1) this.spawnLoot('gold', enemy.group.position);
    if (Math.random() < 0.35) this.spawnLoot('med', enemy.group.position);
    this.makeSplash(enemy.group.position, '#f8d66d', 1.1); this.audio.sink();
  }

  private spawnEnemy(): void {
    const rank = Math.min(12, Math.max(1, Math.floor(this.hullLevel * 0.65) + Math.floor(this.wave / 2) + THREE.MathUtils.randInt(-1, 2)));
    const angle = Math.random() * Math.PI * 2;
    const group = this.createShip('#7d4d28', '#ded3b5', '#111111', 'raft');
    group.position.set(Math.cos(angle) * (SEA.halfWidth - 4), 0, Math.sin(angle) * (SEA.halfDepth - 4)); group.scale.setScalar(0.82 + rank * 0.08);
    this.applyShipUpgradeVisual(group, rank);
    const names = ['Black Finn', 'Red Hook', 'Mako', 'Storm Rat', 'One-Eye', 'Cannon Kid', 'Sea Fang', 'Drift Jack', 'Skull Minnow'];
    this.scene.add(group); this.enemies.push({ group, velocity: new THREE.Vector3(), hp: 45 + rank * 22, maxHp: 45 + rank * 22, cooldown: 0.8 + Math.random() * 1.6, collideCooldown: Math.random() * 0.3, seed: Math.random() * 100, rank, coins: Math.random() * 18, levelTimer: 7 + Math.random() * 8, name: names[Math.floor(Math.random() * names.length)] });
  }

  private spawnLoot(kind: Loot['kind'], origin?: THREE.Vector3): void {
    const group = new THREE.Group();
    const mat = kind === 'gold'
      ? new THREE.MeshStandardMaterial({ color: '#8a5a30', roughness: 0.72 })
      : new THREE.MeshStandardMaterial({ color: '#f8f8f8', roughness: 0.42, emissive: '#2bff72', emissiveIntensity: 0.18 });
    const accent = new THREE.MeshStandardMaterial({ color: kind === 'gold' ? '#f8d66d' : '#e54b39', roughness: 0.35, metalness: 0.18 });
    const body = new THREE.Mesh(kind === 'gold' ? new THREE.BoxGeometry(0.72, 0.48, 0.72) : new THREE.BoxGeometry(0.72, 0.36, 0.72), mat);
    const bandA = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.18), accent); const bandB = bandA.clone(); bandA.position.y = 0.26; bandB.position.y = 0.26; bandB.rotation.y = Math.PI / 2;
    group.add(body, bandA, bandB);
    group.position.copy(origin ?? this.randomOpenWaterPosition());
    if (origin) group.position.add(new THREE.Vector3(THREE.MathUtils.randFloatSpread(4), 0, THREE.MathUtils.randFloatSpread(4)));
    this.clampToSea(group.position, 2);
    this.pushPointOffIslands(group.position, 1.1);
    this.scene.add(group);
    this.loot.push({ group, kind, value: kind === 'gold' ? 7 + Math.floor(Math.random() * 8) : 22, active: true, bob: Math.random() * 10 });
  }

  private randomOpenWaterPosition(): THREE.Vector3 {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const point = new THREE.Vector3(
        THREE.MathUtils.randFloatSpread(SEA.halfWidth * 1.65),
        0,
        THREE.MathUtils.randFloatSpread(SEA.halfDepth * 1.65),
      );
      if (!this.isPointOnIsland(point, 1.25)) return point;
    }
    return new THREE.Vector3(0, 0, 0);
  }

  private isPointOnIsland(point: THREE.Vector3, margin = 0): boolean {
    return ISLAND_COLLIDERS.some((island) => {
      if (island.dock && point.distanceTo(island.dock) < island.dockRadius) return false;
      return point.distanceTo(island.center) < island.radius + margin;
    });
  }

  private addAlly(): void {
    const group = this.createShip('#9b6634', '#ded3b5', this.flagColor, 'raft');
    group.scale.setScalar(0.65); group.position.copy(this.player.position).add(new THREE.Vector3(-2 - this.allies.length, 0, 2));
    this.applyShipUpgradeVisual(group, Math.max(1, Math.floor(this.hullLevel / 2)));
    this.scene.add(group); this.allies.push({ group, velocity: new THREE.Vector3(), cooldown: 0.7, offset: new THREE.Vector3(-2.2 - this.allies.length * 1.3, 0, 2.2 + this.allies.length * 0.8) });
  }

  private createCastaways(): void {
    const points = [[24, 15], [-22, 17], [27, -12]] as const;
    points.forEach(([x, z], i) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.35, 4, 8), new THREE.MeshStandardMaterial({ color: '#f2c08c', roughness: 0.7 }));
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.35), new THREE.MeshBasicMaterial({ color: '#fff4d6', side: THREE.DoubleSide }));
      flag.position.set(0.35, 0.95, 0); group.add(body, flag); group.position.set(x, 0.55, z);
      this.scene.add(group); this.castaways.push({ group, rescued: false, cost: 32 + i * 14 });
    });
  }

  private createShip(hullColor: string, sailColor: string, flagColor: string, mode: 'raft' | 'ship'): THREE.Group {
    const ship = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.68, metalness: 0.04 });
    const deckMat = new THREE.MeshStandardMaterial({ color: '#6e4326', roughness: 0.78 });
    if (mode === 'raft') {
      const canoe = new THREE.Group();
      canoe.name = 'base-hull';
      const center = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.32, 1.45), hullMat);
      center.position.y = 0.36;
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.78, 4), hullMat);
      bow.position.set(0, 0.38, -1.02);
      bow.rotation.x = -Math.PI / 2;
      bow.scale.set(0.72, 0.95, 1);
      const stern = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.52, 4), hullMat);
      stern.position.set(0, 0.37, 0.94);
      stern.rotation.x = Math.PI / 2;
      stern.scale.set(0.68, 0.85, 1);
      const leftGunwale = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 1.95), deckMat);
      leftGunwale.position.set(-0.48, 0.58, -0.02);
      const rightGunwale = leftGunwale.clone();
      rightGunwale.position.x = 0.48;
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.08, 1.05), new THREE.MeshStandardMaterial({ color: '#3b2416', roughness: 0.82 }));
      inner.position.set(0, 0.6, 0.1);
      const noseStripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 0.45), new THREE.MeshStandardMaterial({ color: '#f8d66d', roughness: 0.45, metalness: 0.12 }));
      noseStripe.position.set(0, 0.7, -1.15);
      noseStripe.rotation.x = 0.28;
      canoe.add(center, bow, stern, leftGunwale, rightGunwale, inner, noseStripe);
      ship.add(canoe);
    } else {
      const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 1.85, 5, 14), hullMat); hull.scale.set(1, 0.42, 1.55); hull.rotation.x = Math.PI / 2; hull.position.y = 0.34;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 1.85), deckMat); deck.position.y = 0.63; ship.add(hull, deck);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 1.45, 8), deckMat); mast.name = 'base-mast'; mast.position.y = 1.2;
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.72), new THREE.MeshStandardMaterial({ color: sailColor, roughness: 0.8, side: THREE.DoubleSide })); sail.name = 'base-sail'; sail.position.set(0, 1.22, -0.08); sail.rotation.y = Math.PI / 2;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.28), new THREE.MeshBasicMaterial({ color: flagColor, side: THREE.DoubleSide })); flag.name = 'flag'; flag.position.set(0.02, 1.92, -0.1); flag.rotation.y = Math.PI / 2;
    ship.add(mast, sail, flag);
    ship.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    return ship;
  }

  private paintFlag(ship: THREE.Group, color: string): void {
    const flag = ship.getObjectByName('flag') as THREE.Mesh | undefined;
    if (flag?.material instanceof THREE.MeshBasicMaterial) flag.material.color.set(color);
  }

  private applyShipUpgradeVisual(ship: THREE.Group, level: number): void {
    const previous = ship.getObjectByName('upgrade-kit');
    if (previous) ship.remove(previous);
    const baseHull = ship.getObjectByName('base-hull');
    if (baseHull) baseHull.visible = false;
    const kit = new THREE.Group();
    kit.name = 'upgrade-kit';
    const cannonMat = new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.32, metalness: 0.76 });
    const goldMat = new THREE.MeshStandardMaterial({ color: '#f8d66d', roughness: 0.42, metalness: 0.18 });
    const woodMat = new THREE.MeshStandardMaterial({ color: '#7d4d28', roughness: 0.72 });
    const deckMat = new THREE.MeshStandardMaterial({ color: '#4b2a18', roughness: 0.72 });
    const steelMat = new THREE.MeshStandardMaterial({ color: '#5d6870', roughness: 0.42, metalness: 0.45 });
    const runwayMat = new THREE.MeshStandardMaterial({ color: '#2f3438', roughness: 0.52, metalness: 0.2 });
    const levelClamped = Math.max(1, Math.min(12, Math.floor(level)));
    const baseMast = ship.getObjectByName('base-mast');
    const baseSail = ship.getObjectByName('base-sail');
    if (baseMast) baseMast.visible = false;
    if (baseSail) baseSail.visible = false;

    if (levelClamped <= 2) {
      const logs = levelClamped === 1 ? [-0.18, 0.18] : [-0.42, -0.14, 0.14, 0.42];
      for (const x of logs) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.55, 8), woodMat);
        log.rotation.x = Math.PI / 2;
        log.position.set(x, 0.78, -0.05);
        kit.add(log);
      }
      const rope = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.16), goldMat);
      rope.position.set(0, 0.92, -0.32);
      kit.add(rope);
      const bowTie = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 0.12), deckMat);
      bowTie.position.set(0, 0.92, -0.72);
      const sternTie = bowTie.clone();
      sternTie.position.z = 0.62;
      kit.add(bowTie, sternTie);
      if (levelClamped === 2) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.28), deckMat);
        crate.position.set(0, 1.02, 0.2);
        kit.add(crate);
      }
    } else if (levelClamped <= 5) {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.28, 1.75), woodMat);
      hull.position.set(0, 0.78, -0.02);
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.62, 4), woodMat);
      bow.position.set(0, 0.78, -1.15);
      bow.rotation.x = -Math.PI / 2;
      const stern = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.28, 0.28), deckMat);
      stern.position.set(0, 0.8, 0.95);
      kit.add(hull, bow, stern);
      const prow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 8), goldMat);
      prow.position.set(0, 0.92, -1.5);
      prow.rotation.x = -Math.PI / 2;
      kit.add(prow);
      for (const x of [-0.62, 0.62]) {
        const outrigger = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.35, 7), deckMat);
        outrigger.rotation.x = Math.PI / 2;
        outrigger.position.set(x, 0.78, 0.03);
        kit.add(outrigger);
        if (levelClamped >= 4) {
          const strutA = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.045, 0.05), goldMat);
          strutA.position.set(x * 0.5, 0.92, -0.45);
          const strutB = strutA.clone();
          strutB.position.z = 0.45;
          kit.add(strutA, strutB);
        }
      }
      if (levelClamped >= 4) {
        const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 1.9), deckMat);
        leftRail.position.set(-0.54, 0.98, -0.05);
        const rightRail = leftRail.clone();
        rightRail.position.x = 0.54;
        kit.add(leftRail, rightRail);
      }
    } else if (levelClamped <= 9) {
      const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 2.25, 5, 16), woodMat);
      hull.scale.set(1.05, 0.42, 1.75);
      hull.rotation.x = Math.PI / 2;
      hull.position.y = 0.78;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.12, 2.45), deckMat);
      deck.position.y = 1.08;
      const frontMast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 1.7, 8), deckMat);
      frontMast.position.set(0, 1.74, -0.55);
      const rearMast = frontMast.clone();
      rearMast.position.z = 0.45;
      const sailA = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.65), new THREE.MeshStandardMaterial({ color: '#fff2d0', roughness: 0.8, side: THREE.DoubleSide }));
      sailA.position.set(0, 1.72, -0.55);
      sailA.rotation.y = 0;
      const sailB = sailA.clone();
      sailB.position.z = 0.45;
      kit.add(hull, deck, frontMast, rearMast, sailA, sailB);
      for (const [x, z] of [[-0.74, -0.65], [0.74, -0.65], [-0.74, 0.18], [0.74, 0.18], [-0.74, 0.82], [0.74, 0.82]] as const) {
        const port = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.16), cannonMat);
        port.position.set(x, 1.02, z);
        kit.add(port);
      }
      if (levelClamped >= 7) {
        const bowDeck = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.5), goldMat);
        bowDeck.position.set(0, 1.2, -1.25);
        const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.95, 8), deckMat);
        bowsprit.rotation.x = Math.PI / 2;
        bowsprit.position.set(0, 1.26, -1.68);
        kit.add(bowDeck, bowsprit);
      }
      if (levelClamped >= 9) {
        const thirdMast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 1.5, 8), deckMat);
        thirdMast.position.set(0, 1.68, 1.05);
        const sailC = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.55), new THREE.MeshStandardMaterial({ color: '#ffe7a8', roughness: 0.8, side: THREE.DoubleSide }));
        sailC.position.set(0, 1.68, 1.05);
        sailC.rotation.y = 0;
        kit.add(thirdMast, sailC);
      }
    } else {
      const carrier = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.38, 3.35), steelMat);
      carrier.position.set(0, 0.78, -0.05);
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.88, 0.8, 4), steelMat);
      bow.position.set(0, 0.78, -1.95);
      bow.rotation.x = -Math.PI / 2;
      bow.scale.x = 1.2;
      const runway = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.04, 3.25), runwayMat);
      runway.position.set(0, 1.01, -0.08);
      const island = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.48, 0.55), steelMat);
      island.position.set(0.52, 1.34, -0.35);
      const runwayLine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 2.65), goldMat);
      runwayLine.position.set(0, 1.055, -0.1);
      const sternDeck = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 0.56), steelMat);
      sternDeck.position.set(0, 1.16, 1.55);
      kit.add(carrier, bow, runway, island, runwayLine, sternDeck);
      if (levelClamped >= 11) {
        for (const [x, z] of [[-0.35, -0.8], [0.32, 0.45]] as const) {
          const jet = new THREE.Group();
          const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.38), goldMat);
          const wing = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.035, 0.12), goldMat);
          jet.add(body, wing);
          jet.position.set(x, 1.11, z);
          kit.add(jet);
        }
      }
      if (levelClamped >= 12) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, 0.3), steelMat);
        tower.position.set(0.56, 1.8, -0.52);
        const radar = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.015, 8, 24), goldMat);
        radar.position.set(0.56, 2.08, -0.52);
        radar.rotation.y = Math.PI / 2;
        const deckMarkA = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.055, 0.05), goldMat);
        deckMarkA.position.set(0, 1.08, -1.25);
        const deckMarkB = deckMarkA.clone();
        deckMarkB.rotation.y = Math.PI / 2;
        deckMarkB.position.z = -0.15;
        kit.add(tower, radar, deckMarkA, deckMarkB);
      }
    }

    const cannonCount = Math.min(5, Math.max(1, Math.ceil(levelClamped / 3) + Math.floor(this.cannonLevel / 3)));
    const cannonY = levelClamped >= 10 ? 1.08 : levelClamped >= 6 ? 1.15 : levelClamped >= 3 ? 0.93 : 0.9;
    const cannonZ = levelClamped >= 10 ? -1.15 : levelClamped >= 6 ? -1.18 : levelClamped >= 3 ? -0.88 : -0.62;
    for (let i = 0; i < cannonCount; i += 1) {
      const spread = (i - (cannonCount - 1) / 2) * 0.16;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.28), deckMat);
      base.position.set(spread, cannonY - 0.08, cannonZ + 0.08);
      kit.add(base);
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.095, 0.62, 12), cannonMat);
      cannon.position.set(spread, cannonY, cannonZ);
      cannon.rotation.x = Math.PI / 2;
      kit.add(cannon);
    }
    ship.add(kit);
  }

  private createOcean(): THREE.Mesh {
    const texture = this.createWaterTexture(); texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(11, 8);
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(SEA.halfWidth * 2.5, SEA.halfDepth * 2.5, 64, 64), new THREE.MeshStandardMaterial({ color: '#12b8d7', map: texture, roughness: 0.39, metalness: 0.02 }));
    ocean.rotation.x = -Math.PI / 2; ocean.receiveShadow = true; return ocean;
  }

  private createWorldProps(): THREE.Group {
    const props = new THREE.Group(); const sand = new THREE.MeshStandardMaterial({ color: '#ffd36f', roughness: 0.82 }); const palm = new THREE.MeshStandardMaterial({ color: '#31c85d', roughness: 0.68 }); const trunk = new THREE.MeshStandardMaterial({ color: '#a76027', roughness: 0.72 }); const rockMat = new THREE.MeshStandardMaterial({ color: '#d9e1dc', roughness: 0.88 }); const pierMat = new THREE.MeshStandardMaterial({ color: '#9a5b24', roughness: 0.75 });
    for (const [x, z, s] of [[-27, -17, 1.85], [24, 15, 1.4], [-22, 17, 1.1], [27, -12, 1.0]] as const) {
      const island = new THREE.Group(); const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6 * s, 3.4 * s, 0.45, 18), sand); base.position.y = 0.05; island.add(base);
      const shore = new THREE.Mesh(new THREE.RingGeometry(2.72 * s, 3.55 * s, 30), new THREE.MeshBasicMaterial({ color: '#f6ffff', transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
      shore.rotation.x = -Math.PI / 2;
      shore.position.y = 0.07;
      island.add(shore);
      for (let r = 0; r < 4; r += 1) {
        const angle = r * Math.PI * 0.5 + (x + z) * 0.03;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry((0.22 + r * 0.035) * s, 0), rockMat);
        rock.position.set(Math.cos(angle) * 2.35 * s, 0.38, Math.sin(angle) * 2.05 * s);
        rock.rotation.set(r * 0.6, angle, r * 0.35);
        island.add(rock);
      }
      for (let i = 0; i < 3; i += 1) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 1.2, 7), trunk); t.position.set((i - 1) * 0.6 * s, 0.8, Math.sin(i) * 0.55 * s); const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 7), palm); leaves.position.copy(t.position).add(new THREE.Vector3(0, 0.85, 0)); island.add(t, leaves); }
      if (x === UPGRADE_ISLAND.x) {
        const shop = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.8, 6), new THREE.MeshStandardMaterial({ color: '#f8d66d', roughness: 0.45, emissive: '#7b5b05', emissiveIntensity: 0.2 }));
        shop.position.y = 0.7; island.add(shop);
        for (const dz of [-1.3, 1.3]) {
          const pier = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.16, 0.28), pierMat);
          pier.position.set(4.15, 0.35, dz);
          island.add(pier);
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 8), pierMat);
          post.position.set(6.1, 0.55, dz);
          island.add(post);
        }
        const notchWater = new THREE.Mesh(new THREE.CircleGeometry(1.55, 28), new THREE.MeshBasicMaterial({ color: '#13cce2', transparent: true, opacity: 0.9 }));
        notchWater.rotation.x = -Math.PI / 2;
        notchWater.position.set(5.85, 0.08, 0);
        island.add(notchWater);
      } else {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(1.5 * s, 0.14, 0.28 * s), pierMat);
        pier.position.set(-2.45 * s, 0.32, 0.3 * s);
        pier.rotation.y = 0.25;
        island.add(pier);
      }
      island.position.set(x, 0, z); props.add(island);
    }
    return props;
  }

  private createRouteLine(): THREE.Line {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#2cff75', transparent: true, opacity: 0.95 }));
  }

  private updateGuidance(): void {
    const canBuy = this.coins >= this.minUpgradeCost();
    this.routeLine.visible = canBuy;
    this.islandMarker.visible = true;
    if (canBuy) this.routeLine.geometry.setFromPoints([this.player.position.clone().setY(0.12), UPGRADE_ISLAND.clone().setY(0.12)]);
    const player = this.getElement('#map-player'); const island = this.getElement('#map-upgrade'); const line = this.getElement('#map-line');
    const px = ((this.player.position.x / SEA.halfWidth) * 0.5 + 0.5) * 100; const py = ((this.player.position.z / SEA.halfDepth) * 0.5 + 0.5) * 100;
    const ix = ((UPGRADE_ISLAND.x / SEA.halfWidth) * 0.5 + 0.5) * 100; const iy = ((UPGRADE_ISLAND.z / SEA.halfDepth) * 0.5 + 0.5) * 100;
    player.style.left = `${px}%`; player.style.top = `${py}%`; island.style.left = `${ix}%`; island.style.top = `${iy}%`;
    const dx = ix - px; const dy = iy - py; line.style.left = `${px}%`; line.style.top = `${py}%`; line.style.width = `${Math.hypot(dx, dy)}%`; line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`; line.style.display = canBuy ? 'block' : 'none';
    this.mapEnemies.replaceChildren(...this.enemies.map((enemy) => {
      const dot = document.createElement('i');
      dot.className = 'map-enemy';
      dot.style.left = `${((enemy.group.position.x / SEA.halfWidth) * 0.5 + 0.5) * 100}%`;
      dot.style.top = `${((enemy.group.position.z / SEA.halfDepth) * 0.5 + 0.5) * 100}%`;
      dot.style.transform = `translate(-50%, -50%) scale(${Math.min(1.8, 0.8 + enemy.rank * 0.12)})`;
      return dot;
    }));
  }

  private updateUpgradeOverlay(): void {
    const overlay = this.getElement('#upgrade-overlay');
    overlay.classList.toggle('visible', this.upgradeOpen && !this.gameOver);
    const costs = { cannon: this.cannonLevel * 28, hull: this.hullLevel * 30, speed: this.speedLevel * 24 };
    const labels = {
      cannon: `升级火炮 Lv.${this.cannonLevel} → ${this.cannonLevel + 1}（$${costs.cannon}）`,
      hull: this.hullLevel >= 12 ? '船体已满级：航空母舰' : `升级船体 Lv.${this.hullLevel} → ${this.hullLevel + 1}（$${costs.hull}）`,
      speed: `升级航速 Lv.${this.speedLevel} → ${this.speedLevel + 1}（$${costs.speed}）`,
    };
    for (const kind of ['cannon', 'hull', 'speed'] as const) {
      const button = this.getElement(`#upgrade-${kind}`) as HTMLButtonElement;
      button.textContent = labels[kind];
      button.disabled = this.coins < costs[kind] || (kind === 'hull' && this.hullLevel >= 12);
    }
  }

  private resolveIslandCollision(position: THREE.Vector3, shipRadius: number): void {
    for (const island of ISLAND_COLLIDERS) {
      if (island.dock && position.distanceTo(island.dock) < island.dockRadius) continue;
      const offset = position.clone().sub(island.center);
      offset.y = 0;
      const distance = offset.length();
      const minDistance = island.radius + shipRadius;
      if (distance > 0.001 && distance < minDistance) {
        offset.normalize();
        position.x = island.center.x + offset.x * minDistance;
        position.z = island.center.z + offset.z * minDistance;
        if (position === this.player.position) this.playerVelocity.multiplyScalar(0.25);
      }
    }
  }

  private pushPointOffIslands(position: THREE.Vector3, margin: number): void {
    for (const island of ISLAND_COLLIDERS) {
      if (island.dock && position.distanceTo(island.dock) < island.dockRadius) continue;
      const offset = position.clone().sub(island.center).setY(0);
      const distance = offset.length();
      const minDistance = island.radius + margin;
      if (distance > 0.001 && distance < minDistance) {
        offset.normalize();
        position.x = island.center.x + offset.x * minDistance;
        position.z = island.center.z + offset.z * minDistance;
      }
    }
  }

  private updateNameplates(): void {
    if (this.paused || this.gameOver || this.upgradeOpen) {
      this.nameplates.replaceChildren();
      return;
    }
    const entries: Array<{ label: string; position: THREE.Vector3; hp: number; maxHp: number; kind: string }> = [
      { label: `YOU Lv.${this.hullLevel}`, position: this.player.position, hp: this.hp, maxHp: this.maxHp(), kind: 'player' },
      ...this.enemies.map((enemy) => ({ label: `${enemy.name} Lv.${enemy.rank}`, position: enemy.group.position, hp: enemy.hp, maxHp: enemy.maxHp, kind: 'enemy' })),
      ...this.allies.map((ally, index) => ({ label: `ALLY ${index + 1}`, position: ally.group.position, hp: 1, maxHp: 1, kind: 'ally' })),
    ];
    this.nameplates.replaceChildren(...entries.map((entry) => {
      const screen = entry.position.clone().add(new THREE.Vector3(0, 2.3 * Math.max(1, entry.position === this.player.position ? this.player.scale.x : 1), 0)).project(this.camera);
      const plate = document.createElement('div');
      plate.className = `nameplate ${entry.kind}`;
      plate.style.left = `${(screen.x * 0.5 + 0.5) * window.innerWidth}px`;
      plate.style.top = `${(-screen.y * 0.5 + 0.5) * window.innerHeight}px`;
      plate.style.display = screen.z > 1 ? 'none' : 'block';
      const fill = Math.max(0, Math.min(1, entry.hp / entry.maxHp));
      plate.innerHTML = `<span>${entry.label}</span><div class="bar"><i style="transform:scaleX(${fill})"></i></div>`;
      return plate;
    }));
  }

  private spawnDamageText(position: THREE.Vector3, amount: number, kind: 'enemy' | 'player'): void {
    const element = document.createElement('div');
    element.className = `damage-float ${kind === 'player' ? 'player-hit' : 'enemy-hit'}`;
    element.textContent = `-${Math.round(amount)}`;
    this.floatingTextsLayer.appendChild(element);
    this.floatingTexts.push({
      element,
      position: position.clone().add(new THREE.Vector3(0, 1.35, 0)),
      life: 0.82,
      maxLife: 0.82,
      lift: 1.25 + Math.random() * 0.35,
    });
  }

  private updateFloatingTexts(delta: number): void {
    for (let i = this.floatingTexts.length - 1; i >= 0; i -= 1) {
      const text = this.floatingTexts[i];
      text.life -= delta;
      text.position.y += text.lift * delta;
      const progress = 1 - Math.max(0, text.life / text.maxLife);
      const screen = text.position.clone().project(this.camera);
      text.element.style.left = `${(screen.x * 0.5 + 0.5) * window.innerWidth}px`;
      text.element.style.top = `${(-screen.y * 0.5 + 0.5) * window.innerHeight}px`;
      text.element.style.opacity = `${Math.max(0, text.life / text.maxLife)}`;
      text.element.style.transform = `translate(-50%, -50%) translateY(${-18 * progress}px) scale(${1 + progress * 0.22})`;
      text.element.style.display = screen.z > 1 ? 'none' : 'block';
      if (text.life <= 0) {
        text.element.remove();
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  private makeSplash(position: THREE.Vector3, color: string, scale = 0.7): void {
    const group = new THREE.Group(); group.userData.life = 0.38; group.userData.maxLife = 0.38; const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 9; i += 1) { const shard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.35 * scale), mat.clone()); shard.position.copy(position); shard.position.y = 0.42; shard.rotation.y = (i / 9) * Math.PI * 2; shard.position.x += Math.cos(shard.rotation.y) * 0.32 * scale; shard.position.z += Math.sin(shard.rotation.y) * 0.32 * scale; group.add(shard); }
    this.scene.add(group); this.vfx.push(group);
  }

  private makeMuzzlePuff(position: THREE.Vector3, color: string): void {
    const group = new THREE.Group();
    group.userData.life = 0.16;
    group.userData.maxLife = 0.16;
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    flash.position.copy(position);
    flash.position.y = 0.58;
    group.add(flash);
    this.scene.add(group);
    this.vfx.push(group);
  }

  private updateVfx(delta: number): void {
    for (let i = this.vfx.length - 1; i >= 0; i -= 1) { const group = this.vfx[i]; group.userData.life -= delta; group.scale.multiplyScalar(1 + delta * 2.4); for (const child of group.children) if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) child.material.opacity = Math.max(0, group.userData.life / group.userData.maxLife); if (group.userData.life <= 0) { this.scene.remove(group); this.vfx.splice(i, 1); } }
  }

  private createWake(ship: THREE.Group, size: number): void {
    const wake = new THREE.Group();
    wake.userData.life = 0.5;
    wake.userData.maxLife = 0.5;
    const mat = new THREE.MeshBasicMaterial({ color: '#f4ffff', transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
    for (const x of [-0.22, 0.22]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.07 * size, 0.16 * size, 20), mat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x * size, 0, 0);
      wake.add(ring);
    }
    const behind = new THREE.Vector3(0, 0, 0.52 * size).applyQuaternion(ship.quaternion);
    wake.position.copy(ship.position).add(behind);
    wake.position.y = 0.12;
    wake.rotation.y = ship.rotation.y;
    this.scene.add(wake);
    this.vfx.push(wake);
  }

  private createWaterTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; const ctx = c.getContext('2d'); if (!ctx) throw new Error('Missing canvas context');
    const gradient = ctx.createLinearGradient(0, 0, 512, 512); gradient.addColorStop(0, '#0698ce'); gradient.addColorStop(0.55, '#11c6df'); gradient.addColorStop(1, '#32e0d1'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(245,255,255,.26)'; ctx.lineWidth = 3; for (let y = -80; y < 620; y += 38) { ctx.beginPath(); for (let x = -20; x < 560; x += 20) ctx.lineTo(x, y + Math.sin(x * 0.04 + y) * 8); ctx.stroke(); }
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }

  private clampToSea(position: THREE.Vector3, margin: number): void {
    position.x = THREE.MathUtils.clamp(position.x, -SEA.halfWidth + margin, SEA.halfWidth - margin);
    position.z = THREE.MathUtils.clamp(position.z, -SEA.halfDepth + margin, SEA.halfDepth - margin);
  }

  private removeBall(index: number): void { const [ball] = this.balls.splice(index, 1); this.scene.remove(ball.mesh); }

  private clearDynamic(): void {
    for (const ball of this.balls) this.scene.remove(ball.mesh);
    for (const enemy of this.enemies) this.scene.remove(enemy.group);
    for (const item of this.loot) this.scene.remove(item.group);
    for (const ally of this.allies) this.scene.remove(ally.group);
    for (const castaway of this.castaways) this.scene.remove(castaway.group);
    for (const effect of this.vfx) this.scene.remove(effect);
    for (const text of this.floatingTexts) text.element.remove();
    this.balls.length = 0; this.enemies.length = 0; this.loot.length = 0; this.allies.length = 0; this.castaways.length = 0; this.vfx.length = 0;
    this.floatingTexts.length = 0;
  }

  private getHudState(): HudState {
    return { hp: this.hp, maxHp: this.maxHp(), coins: this.coins, kills: this.kills, wave: this.wave, cannonLevel: this.cannonLevel, hullLevel: this.hullLevel, speedLevel: this.speedLevel, elapsed: this.elapsed, gameOver: this.gameOver, paused: this.paused, cannonCost: this.cannonLevel * 28, hullCost: this.hullLevel * 30, speedCost: this.speedLevel * 24, ammo: this.ammo, maxAmmo: this.maxAmmo, reloading: this.reloading, reloadTimer: this.reloadTimer, nearUpgrade: this.player.position.distanceTo(UPGRADE_ISLAND) < 5.2, canUpgrade: this.coins >= this.minUpgradeCost(), allies: this.allies.length };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = { frame: this.frame, elapsed: this.elapsed, wave: this.wave, coins: this.coins, kills: this.kills, gameOver: this.gameOver, paused: this.paused, entities: { enemies: this.enemies.length, cannonBalls: this.balls.length, crates: this.loot.filter((item) => item.active).length, vfx: this.vfx.length }, player: { hp: this.hp, position: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z }, speed: this.playerVelocity.length() }, renderer: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures }, canvas: { clientWidth: this.canvas.clientWidth, clientHeight: this.canvas.clientHeight, width: this.canvas.width, height: this.canvas.height, dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr) } };
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
