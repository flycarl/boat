import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { OceanSurface } from '../environment/OceanSurface';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig } from '../systems/CameraRig';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud, type HudState } from '../systems/Hud';
import { disposeObject3D } from '../utils/dispose';

const SEA = { halfWidth: 64, halfDepth: 46 };
const UPGRADE_ISLAND = new THREE.Vector3(-23, 0, -14);
const UPGRADE_DOCK = new THREE.Vector3(-17.2, 0, -14);
const MAX_START_AMMO = 10;
const ISLAND_COLLIDERS = [
  { center: UPGRADE_ISLAND, radius: 5.7, dock: UPGRADE_DOCK, dockRadius: 2.35 },
  { center: new THREE.Vector3(20, 0, 12), radius: 4.2 },
  { center: new THREE.Vector3(-18, 0, 13), radius: 3.25 },
  { center: new THREE.Vector3(21, 0, -10), radius: 3.0 },
];

type Ball = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; age: number; launchY: number; owner: 'player' | 'enemy' | 'ally' | 'remote'; damage: number; source: THREE.Group; killerName?: string; shooterId?: string };
type Loot = { id: string; group: THREE.Group; kind: 'gold' | 'med'; value: number; active: boolean; bob: number };
type ShipAi = {
  id: string;
  group: THREE.Group;
  velocity: THREE.Vector3;
  targetPosition: THREE.Vector3;
  targetRotation: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  collideCooldown: number;
  seed: number;
  rank: number;
  coins: number;
  levelTimer: number;
  name: string;
};
type Ally = { group: THREE.Group; velocity: THREE.Vector3; cooldown: number; offset: THREE.Vector3 };
type Castaway = { group: THREE.Group; dock: THREE.Vector3; rescued: boolean; cost: number };
type FloatingText = { element: HTMLElement; position: THREE.Vector3; life: number; maxLife: number; lift: number };
type CoinFlight = {
  element: HTMLElement;
  value: number;
  elapsed: number;
  duration: number;
  startX: number;
  startY: number;
  spread: number;
};
type BossKind = 'kraken' | 'serpent' | 'crab';
type SeaBoss = { id: string; kind: BossKind; name: string; group: THREE.Group; hp: number; maxHp: number; velocity: THREE.Vector3; cooldown: number; age: number; damage: Map<string, number> };
export type GameOptions = { playerName: string; roomCode: string };
type PrimarySailPattern = 'anchor' | 'skull' | 'sun' | 'compass';
type SecondarySailPattern = 'waves' | 'stripes' | 'diamonds' | 'stars';
type SailDesign = {
  primaryPattern: PrimarySailPattern;
  secondaryPattern: SecondarySailPattern;
  primaryColor: string;
  secondaryColor: string;
};
type RoomMessage = {
  type: 'state';
  id: string;
  room: string;
  name: string;
  x: number;
  z: number;
  rotation: number;
  hullLevel: number;
  coins: number;
  hp: number;
  maxHp: number;
  flagColor: string;
  sailPrimaryPattern?: PrimarySailPattern;
  sailSecondaryPattern?: SecondarySailPattern;
  sailSecondaryColor?: string;
  active: boolean;
};
type KillMessage = { type: 'kill'; id: string; room: string; killer: string; victim: string };
type ProjectileMessage = { type: 'projectile'; id: string; room: string; projectileId: string; shooterName: string; x: number; y?: number; z: number; vx: number; vz: number; damage: number };
type LootDropMessage = { type: 'loot-drop'; id: string; room: string; dropId: string; x: number; z: number; value: number };
type LootPickupMessage = { type: 'loot-pickup'; id: string; room: string; dropId: string };
type PresenceMessage = { type: 'join' | 'leave'; id: string; room: string; name: string };
type EnemySnapshot = { id: string; name: string; x: number; z: number; y: number; rotation: number; vx: number; vz: number; rank: number; hp: number; maxHp: number; coins: number; seed: number };
type EnemyStateMessage = { type: 'enemy-state'; id: string; room: string; enemies: EnemySnapshot[] };
type BossStateMessage = { type: 'boss-state'; id: string; room: string; boss: { id: string; kind: BossKind; name: string; x: number; z: number; rotation: number; hp: number; maxHp: number } | null };
type BossRewardMessage = { type: 'boss-reward'; id: string; room: string; recipientId: string; amount: number };
type NetworkMessage = RoomMessage | KillMessage | ProjectileMessage | LootDropMessage | LootPickupMessage | PresenceMessage | EnemyStateMessage | BossStateMessage | BossRewardMessage;
type RemotePeer = {
  group: THREE.Group;
  targetPosition: THREE.Vector3;
  targetRotation: number;
  name: string;
  hp: number;
  maxHp: number;
  hullLevel: number;
  coins: number;
  lastSeen: number;
  collideCooldown: number;
};

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 280);
  private readonly raycaster = new THREE.Raycaster();
  private readonly seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly mouse = new THREE.Vector2();
  private readonly mouseWorld = new THREE.Vector3();
  private readonly input: InputController;
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly ocean = new OceanSurface(SEA.halfWidth, SEA.halfDepth);
  private readonly loop = new Loop((delta, elapsed) => this.update(delta, elapsed), () => this.render());
  private readonly tuning: DebugTuning = { speed: 5.4, dashMultiplier: 1, acceleration: 3.2, cameraLag: 0.13, exposure: 1.08, maxDpr: 1.75 };
  private readonly debugTools: DebugTools;
  private readonly sailDesign: SailDesign = {
    primaryPattern: 'anchor',
    secondaryPattern: 'waves',
    primaryColor: '#e54b39',
    secondaryColor: '#173f5f',
  };
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
  private readonly killFeed = this.getElement('#kill-feed');
  private readonly leaderboard = this.getElement('#leaderboard');
  private readonly mapEnemies = this.getElement('#map-enemies');
  private readonly mapIslands = this.getElement('#map-islands');
  private readonly app = this.getElement('#app');
  private readonly remotePeers = new Map<string, RemotePeer>();
  private readonly pickedLootIds = new Set<string>();
  private readonly clientId: string = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  private readonly roomChannel: BroadcastChannel | null;
  private readonly socket: WebSocket | null;
  private networkTimer = 0;
  private enemySyncTimer = 0;
  private enemyIdCounter = 0;
  private leavingRoom = false;
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
  private sailorOpen = false;
  private dockCooldown = 0;
  private wakeTimer = 0;
  private playerCollideCooldown = 0;
  private sailorRespawnTimer = 0;
  private readonly floatingTexts: FloatingText[] = [];
  private readonly coinFlights: CoinFlight[] = [];
  private boss: SeaBoss | null = null;
  private bossSpawnTimer = 45;
  private bossSequence = 0;
  private bossSyncTimer = 0;

  private playerShipRadius(): number {
    return 1.0 + Math.min(12, this.hullLevel) * 0.16;
  }

  private shipScaleForLevel(level: number): number {
    return 0.82 + Math.max(1, Math.min(12, Math.floor(level))) * 0.08;
  }

  private cameraScaleForLevel(level: number): number {
    const progress = (Math.max(1, Math.min(12, Math.floor(level))) - 1) / 11;
    return THREE.MathUtils.lerp(0.72, 1.3, progress);
  }

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: GameOptions) {
    this.renderer = createRenderer(canvas);
    // Game is constructed from the join form's trusted submit gesture, so unlock
    // immediately instead of making the player click once more before hearing wind.
    void this.audio.unlock();
    this.getElement('#pause-room-code strong').textContent = options.roomCode;
    this.roomChannel = 'BroadcastChannel' in window ? new BroadcastChannel(`boat-room-${options.roomCode}`) : null;
    this.roomChannel?.addEventListener('message', this.onRoomMessage);
    this.socket = this.createSocket();
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
    this.getElement('#sail-menu').addEventListener('click', this.onSailPatternClick);
    this.getElement('#sail-menu').addEventListener('input', this.onSailColorInput);
    this.getElement('#resume-button').addEventListener('click', () => { this.paused = false; });
    this.getElement('#restart-button').addEventListener('click', () => this.restart());
    this.getElement('#quit-room-button').addEventListener('click', () => this.quitRoom());
    this.getElement('#secret-coin-button').addEventListener('click', () => this.openSecretCoinEntry());
    this.getElement('#close-upgrade').addEventListener('click', () => this.leaveDock());
    this.getElement('#close-sailor').addEventListener('click', () => this.leaveSailorDock());
    this.getElement('#buy-sailor').addEventListener('click', () => this.buySailor());
    this.getElement('#upgrade-cannon').addEventListener('click', () => this.tryUpgrade('cannon'));
    this.getElement('#upgrade-hull').addEventListener('click', () => this.tryUpgrade('hull'));
    this.getElement('#upgrade-speed').addEventListener('click', () => this.tryUpgrade('speed'));
    this.createMinimapIslands();
    this.createScene();
    this.restart();
    this.installDebugBridge();
  }

  start(): void { this.loop.start(); }

  dispose(): void {
    this.loop.stop();
    window.removeEventListener('keydown', this.onKeyDown);
    this.roomChannel?.removeEventListener('message', this.onRoomMessage);
    this.roomChannel?.close();
    this.socket?.close();
    this.input.dispose();
    this.audio.dispose();
    this.debugTools.dispose();
    this.renderer.dispose();
    this.app.classList.remove('menu-open');
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__BOAT_DEBUG__ = undefined;
  }

  private installDebugBridge(): void {
    if (!new URLSearchParams(window.location.search).has('debug')) return;
    window.__BOAT_DEBUG__ = {
      setHullLevel: (level: number) => {
        this.hullLevel = Math.max(1, Math.min(12, Math.floor(level)));
        this.hp = this.maxHp();
        this.resizeFleet();
        this.cameraRig.snapTo(this.player.position, this.cameraScaleForLevel(this.hullLevel));
      },
      setCoins: (value: number) => {
        this.coins = Math.max(0, Math.floor(value));
      },
      setFirstEnemyLevel: (level: number) => {
        const enemy = this.enemies[0];
        if (!enemy) return;
        enemy.rank = Math.max(1, Math.min(12, Math.floor(level)));
        enemy.maxHp = 45 + enemy.rank * 22;
        enemy.hp = enemy.maxHp;
        enemy.group.scale.setScalar(this.shipScaleForLevel(enemy.rank));
        this.applyShipUpgradeVisual(enemy.group, enemy.rank);
      },
      setFirstEnemyCoins: (value: number) => {
        const enemy = this.enemies[0];
        if (enemy) enemy.coins = Math.max(0, Math.floor(value));
      },
      sinkFirstEnemy: () => {
        const enemy = this.enemies[0];
        if (enemy) this.sinkEnemy(enemy, true, this.options.playerName);
      },
      defeatPlayer: () => this.playerKilledBy('Debug'),
      spawnBoss: () => {
        if (this.boss) { this.scene.remove(this.boss.group); disposeObject3D(this.boss.group); this.boss = null; }
        this.spawnBoss();
      },
      defeatBoss: () => {
        if (!this.boss) return;
        this.boss.damage.set(this.clientId, this.boss.maxHp);
        this.boss.hp = 0;
        this.defeatBoss();
      },
      collectNearestGold: () => {
        if (!this.loot.some((item) => item.active && item.kind === 'gold')) this.spawnLoot('gold', this.player.position);
        const gold = this.loot.find((item) => item.active && item.kind === 'gold');
        if (!gold) return;
        this.player.position.copy(gold.group.position).setY(0);
        this.playerVelocity.set(0, 0, 0);
      },
    };
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Escape') {
      if (this.sailorOpen) {
        this.leaveSailorDock();
      } else if (this.upgradeOpen) {
        this.leaveDock();
      } else {
        this.paused = !this.paused;
      }
    }
    if (event.code === 'Backspace') this.restart();
    if (event.code === 'Digit1') this.tryUpgrade('cannon');
    if (event.code === 'Digit2') this.tryUpgrade('hull');
    if (event.code === 'Digit3') this.tryUpgrade('speed');
    if (event.code === 'KeyG' && new URLSearchParams(window.location.search).has('debug')) {
      window.__BOAT_DEBUG__?.collectNearestGold();
    }
  };

  private readonly onSailPatternClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-sail-layer]');
    if (!button) return;
    const layer = button.dataset.sailLayer;
    if (layer === 'primary') this.sailDesign.primaryPattern = button.dataset.sailPattern as PrimarySailPattern;
    if (layer === 'secondary') this.sailDesign.secondaryPattern = button.dataset.sailPattern as SecondarySailPattern;
    this.updateSailEditor();
  };

  private readonly onSailColorInput = (event: Event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-sail-color]');
    if (!input) return;
    if (input.dataset.sailColor === 'primary') this.sailDesign.primaryColor = input.value;
    if (input.dataset.sailColor === 'secondary') this.sailDesign.secondaryColor = input.value;
    this.updateSailEditor();
  };

  private readonly onRoomMessage = (event: MessageEvent<NetworkMessage>) => {
    this.handleNetworkMessage(event.data);
  };

  private createSocket(): WebSocket | null {
    if (!('WebSocket' in window) || location.protocol === 'file:') return null;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'join', id: this.clientId, room: this.options.roomCode, name: this.options.playerName } satisfies PresenceMessage));
    });
    socket.addEventListener('message', (event) => {
      try {
        this.handleNetworkMessage(JSON.parse(String(event.data)) as NetworkMessage);
      } catch {
        // Ignore malformed packets from stale clients.
      }
    });
    return socket;
  }

  private handleNetworkMessage(data: NetworkMessage): void {
    if (!data || data.id === this.clientId || data.room !== this.options.roomCode) return;
    if (data.type === 'kill') {
      this.showKillFeed(data.killer, data.victim);
      return;
    }
    if (data.type === 'projectile') {
      this.spawnRemoteProjectile(data);
      return;
    }
    if (data.type === 'loot-drop') {
      this.spawnLoot('gold', new THREE.Vector3(data.x, 0, data.z), data.value, data.dropId);
      return;
    }
    if (data.type === 'loot-pickup') {
      this.markLootPickedUp(data.dropId);
      return;
    }
    if (data.type === 'enemy-state') {
      if (!this.isEnemyAuthority()) this.applyEnemyState(data.enemies);
      return;
    }
    if (data.type === 'boss-state') {
      if (!this.isEnemyAuthority()) this.applyBossState(data.boss);
      return;
    }
    if (data.type === 'boss-reward') {
      if (data.recipientId === this.clientId) {
        this.coins += data.amount;
        this.spawnCoinFlight(this.player.position, data.amount);
        this.showRoomNotice(`海怪奖励 +${data.amount} 金币`, 'join');
      }
      return;
    }
    if (data.type === 'join') {
      this.showRoomNotice(`${data.name} 加入了房间`, 'join');
      return;
    }
    if (data.type === 'leave') {
      const peer = this.remotePeers.get(data.id);
      if (peer) {
        this.scene.remove(peer.group);
        this.remotePeers.delete(data.id);
        this.showRoomNotice(`${data.name} 退出了房间`, 'leave');
      }
      return;
    }
    if (data.type !== 'state') return;
    let peer = this.remotePeers.get(data.id);
    if (!peer) {
      const group = this.createShip('#7d4d28', '#ded3b5', data.flagColor, 'raft');
      group.position.set(data.x, 0, data.z);
      group.rotation.y = data.rotation;
      group.scale.setScalar(this.shipScaleForLevel(data.hullLevel));
      this.applyShipUpgradeVisual(group, data.hullLevel);
      this.scene.add(group);
      peer = {
        group,
        targetPosition: new THREE.Vector3(data.x, 0, data.z),
        targetRotation: data.rotation,
        name: data.name,
        hp: data.hp,
        maxHp: data.maxHp,
        hullLevel: data.hullLevel,
        coins: data.coins ?? 0,
        lastSeen: performance.now(),
        collideCooldown: 0,
      };
      this.remotePeers.set(data.id, peer);
    }
    peer.name = data.name;
    peer.hp = data.hp;
    peer.maxHp = data.maxHp;
    peer.coins = data.coins ?? 0;
    peer.lastSeen = performance.now();
    peer.targetPosition.set(data.x, 0, data.z);
    peer.targetRotation = data.rotation;
    peer.group.visible = data.active !== false;
    if (peer.hullLevel !== data.hullLevel) {
      peer.hullLevel = data.hullLevel;
      peer.group.scale.setScalar(this.shipScaleForLevel(data.hullLevel));
      this.applyShipUpgradeVisual(peer.group, data.hullLevel);
    }
    this.applySailDesign(peer.group, {
      primaryPattern: data.sailPrimaryPattern ?? 'anchor',
      secondaryPattern: data.sailSecondaryPattern ?? 'waves',
      primaryColor: data.flagColor,
      secondaryColor: data.sailSecondaryColor ?? '#173f5f',
    });
  }

  private spawnRemoteProjectile(data: ProjectileMessage): void {
    const source = this.remotePeers.get(data.id)?.group ?? new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 18, 12),
      new THREE.MeshStandardMaterial({ color: '#020202', roughness: 0.34, metalness: 0.72 }),
    );
    mesh.castShadow = true;
    mesh.position.set(data.x, data.y ?? 0.9, data.z);
    this.scene.add(mesh);
    this.balls.push({
      mesh,
      velocity: new THREE.Vector3(data.vx, 0, data.vz),
      life: 1.55,
      age: 0,
      launchY: mesh.position.y,
      owner: 'remote',
      damage: data.damage,
      source,
      killerName: data.shooterName,
      shooterId: data.id,
    });
    this.makeMuzzlePuff(mesh.position, '#fff1b5');
  }

  private update(deltaRaw: number, elapsedRaw: number): void {
    const delta = Math.min(deltaRaw, 0.05);
    const enemyAuthority = this.isEnemyAuthority();
    this.frame += 1;
    this.ocean.update(elapsedRaw);
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.updateMouseWorld();
    const playerActive = this.isNetworkActive();
    this.app.classList.toggle('menu-open', !playerActive);
    if (playerActive) {
      this.elapsed += delta;
      this.dockCooldown = Math.max(0, this.dockCooldown - delta);
      if (this.input.consumeReload()) this.startReload();
      this.updatePlayer(delta, elapsedRaw);
      this.updateAllies(delta, elapsedRaw);
      if (enemyAuthority) this.updateEnemies(delta, elapsedRaw);
      else this.updateRemoteEnemies(delta);
      this.updateShipCollisions(delta);
      this.updateBalls(delta);
      this.updateLoot(delta, elapsedRaw);
      this.updateCastaways(delta);
      this.updateVfx(delta);
      if (enemyAuthority) {
        this.spawnTimer -= delta;
        if (this.spawnTimer <= 0 && this.enemies.length < 8 + Math.min(this.wave, 6)) { this.spawnEnemy(); this.spawnTimer = Math.max(1.4, 4.2 - this.wave * 0.24); }
      }
      if (this.kills >= this.wave * 4) this.wave += 1;
    }
    if (!playerActive) {
      this.audio.setSailing(0);
      if (enemyAuthority) this.updateEnemies(delta, elapsedRaw);
      else this.updateRemoteEnemies(delta);
      this.updateShipCollisions(delta, false);
      this.updateBalls(delta);
      this.updateLoot(delta, elapsedRaw);
      this.updateVfx(delta);
      if (enemyAuthority) {
        this.spawnTimer -= delta;
        if (this.spawnTimer <= 0 && this.enemies.length < 8 + Math.min(this.wave, 6)) {
          this.spawnEnemy();
          this.spawnTimer = Math.max(1.4, 4.2 - this.wave * 0.24);
        }
      }
    }
    if (enemyAuthority) this.updateBoss(delta, elapsedRaw);
    else this.animateRemoteBoss(delta, elapsedRaw);
    this.updateBossHud();
    this.updateRoomSync(delta);
    this.updateFloatingTexts(delta);
    this.updateCoinFlights(delta);
    this.updateGuidance();
    this.updateNameplates();
    this.nameplates.classList.toggle('hidden', this.paused || this.gameOver || this.upgradeOpen || this.sailorOpen);
    this.updateUpgradeOverlay();
    this.updateSailorOverlay();
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      const fogBlend = 1 - Math.exp(-delta / 0.32);
      fog.near = THREE.MathUtils.lerp(fog.near, playerActive ? 46 : 112, fogBlend);
      fog.far = THREE.MathUtils.lerp(fog.far, playerActive ? 104 : 238, fogBlend);
    }
    if (playerActive) this.cameraRig.update(delta, this.player.position, this.tuning.cameraLag, this.cameraScaleForLevel(this.hullLevel));
    else this.cameraRig.updateOverview(delta);
    this.hud.update(this.getHudState());
    this.publishDiagnostics();
  }

  private updateRoomSync(delta: number): void {
    this.networkTimer -= delta;
    if (this.networkTimer <= 0) {
      this.sendNetworkMessage({
        type: 'state',
        id: this.clientId,
        room: this.options.roomCode,
        name: this.options.playerName,
        x: this.player.position.x,
        z: this.player.position.z,
        rotation: this.player.rotation.y,
        hullLevel: this.hullLevel,
        coins: this.coins,
        hp: this.hp,
        maxHp: this.maxHp(),
        flagColor: this.sailDesign.primaryColor,
        sailPrimaryPattern: this.sailDesign.primaryPattern,
        sailSecondaryPattern: this.sailDesign.secondaryPattern,
        sailSecondaryColor: this.sailDesign.secondaryColor,
        active: this.isNetworkActive(),
      } satisfies RoomMessage);
      this.networkTimer = 0.08;
    }
    if (this.isEnemyAuthority()) {
      this.enemySyncTimer -= delta;
      if (this.enemySyncTimer <= 0) {
        this.sendEnemyState();
        this.enemySyncTimer = 0.05;
      }
      this.bossSyncTimer -= delta;
      if (this.bossSyncTimer <= 0) {
        this.sendBossState();
        this.bossSyncTimer = 0.1;
      }
    }
    const now = performance.now();
    for (const [id, peer] of this.remotePeers) {
      peer.collideCooldown = Math.max(0, peer.collideCooldown - delta);
      if (now - peer.lastSeen > 3500) {
        this.scene.remove(peer.group);
        this.remotePeers.delete(id);
        continue;
      }
      const positionSmoothing = 1 - Math.exp(-12 * delta);
      const rotationSmoothing = 1 - Math.exp(-14 * delta);
      peer.group.position.lerp(peer.targetPosition, positionSmoothing);
      peer.group.rotation.y = this.lerpAngle(peer.group.rotation.y, peer.targetRotation, rotationSmoothing);
    }
  }

  private sendEnemyState(): void {
    this.sendNetworkMessage({
      type: 'enemy-state',
      id: this.clientId,
      room: this.options.roomCode,
      enemies: this.enemies.map((enemy) => ({
        id: enemy.id,
        name: enemy.name,
        x: enemy.group.position.x,
        z: enemy.group.position.z,
        y: enemy.group.position.y,
        rotation: enemy.group.rotation.y,
        vx: enemy.velocity.x,
        vz: enemy.velocity.z,
        rank: enemy.rank,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        coins: enemy.coins,
        seed: enemy.seed,
      })),
    });
  }

  private sendBossState(): void {
    const boss = this.boss;
    this.sendNetworkMessage({
      type: 'boss-state', id: this.clientId, room: this.options.roomCode,
      boss: boss ? { id: boss.id, kind: boss.kind, name: boss.name, x: boss.group.position.x, z: boss.group.position.z, rotation: boss.group.rotation.y, hp: boss.hp, maxHp: boss.maxHp } : null,
    });
  }

  private applyBossState(snapshot: BossStateMessage['boss']): void {
    if (!snapshot) {
      if (this.boss) { this.scene.remove(this.boss.group); disposeObject3D(this.boss.group); this.boss = null; }
      return;
    }
    if (!this.boss || this.boss.id !== snapshot.id) {
      if (this.boss) { this.scene.remove(this.boss.group); disposeObject3D(this.boss.group); }
      const group = this.createBossModel(snapshot.kind);
      group.position.set(snapshot.x, 0.25, snapshot.z);
      this.scene.add(group);
      this.boss = { id: snapshot.id, kind: snapshot.kind, name: snapshot.name, group, hp: snapshot.hp, maxHp: snapshot.maxHp, velocity: new THREE.Vector3(), cooldown: 1, age: 0, damage: new Map() };
    }
    this.boss.hp = snapshot.hp;
    this.boss.maxHp = snapshot.maxHp;
    this.boss.group.position.x = THREE.MathUtils.lerp(this.boss.group.position.x, snapshot.x, 0.45);
    this.boss.group.position.z = THREE.MathUtils.lerp(this.boss.group.position.z, snapshot.z, 0.45);
    this.boss.group.rotation.y = snapshot.rotation;
  }

  private updateRemoteEnemies(delta: number): void {
    const positionSmoothing = 1 - Math.exp(-8 * delta);
    const rotationSmoothing = 1 - Math.exp(-16 * delta);
    for (const enemy of this.enemies) {
      enemy.group.position.addScaledVector(enemy.velocity, delta);
      enemy.group.position.lerp(enemy.targetPosition, positionSmoothing);
      enemy.group.rotation.y = this.lerpAngle(enemy.group.rotation.y, enemy.targetRotation, rotationSmoothing);
    }
  }

  private applyEnemyState(snapshots: EnemySnapshot[]): void {
    const seen = new Set<string>();
    for (const snapshot of snapshots) {
      seen.add(snapshot.id);
      let enemy = this.enemies.find((candidate) => candidate.id === snapshot.id);
      if (!enemy) {
        enemy = this.createEnemyFromSnapshot(snapshot);
        this.scene.add(enemy.group);
        this.enemies.push(enemy);
      }
      enemy.name = snapshot.name;
      enemy.hp = snapshot.hp;
      enemy.maxHp = snapshot.maxHp;
      enemy.coins = snapshot.coins;
      enemy.seed = snapshot.seed;
      enemy.velocity.set(snapshot.vx, 0, snapshot.vz);
      enemy.targetPosition.set(snapshot.x + snapshot.vx * 0.1, snapshot.y, snapshot.z + snapshot.vz * 0.1);
      enemy.targetRotation = snapshot.rotation;
      if (enemy.rank !== snapshot.rank) {
        enemy.rank = snapshot.rank;
        enemy.group.scale.setScalar(this.shipScaleForLevel(snapshot.rank));
        this.applyShipUpgradeVisual(enemy.group, snapshot.rank);
        this.applyEnemySailDesign(enemy.group);
      }
    }
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (seen.has(enemy.id)) continue;
      this.scene.remove(enemy.group);
      this.enemies.splice(i, 1);
    }
  }

  private createEnemyFromSnapshot(snapshot: EnemySnapshot): ShipAi {
    const group = this.createShip('#7d4d28', '#ded3b5', '#111111', 'raft');
    group.position.set(snapshot.x, snapshot.y, snapshot.z);
    group.rotation.y = snapshot.rotation;
    group.scale.setScalar(this.shipScaleForLevel(snapshot.rank));
    this.applyShipUpgradeVisual(group, snapshot.rank);
    this.applyEnemySailDesign(group);
    return {
      id: snapshot.id,
      group,
      velocity: new THREE.Vector3(snapshot.vx, 0, snapshot.vz),
      targetPosition: new THREE.Vector3(snapshot.x + snapshot.vx * 0.1, snapshot.y, snapshot.z + snapshot.vz * 0.1),
      targetRotation: snapshot.rotation,
      hp: snapshot.hp,
      maxHp: snapshot.maxHp,
      cooldown: 1.1,
      collideCooldown: 0,
      seed: snapshot.seed,
      rank: snapshot.rank,
      coins: snapshot.coins,
      levelTimer: 10,
      name: snapshot.name,
    };
  }

  private applyEnemySailDesign(group: THREE.Group): void {
    this.applySailDesign(group, {
      primaryPattern: 'skull',
      secondaryPattern: 'waves',
      primaryColor: '#111111',
      secondaryColor: '#7d4d28',
    });
  }

  private isNetworkActive(): boolean {
    return !this.paused && !this.upgradeOpen && !this.sailorOpen && !this.gameOver;
  }

  private quitRoom(): void {
    if (this.leavingRoom) return;
    this.leavingRoom = true;
    this.loop.stop();
    this.sendNetworkMessage({
      type: 'leave',
      id: this.clientId,
      room: this.options.roomCode,
      name: this.options.playerName,
    });
    window.setTimeout(() => window.location.reload(), 60);
  }

  private openSecretCoinEntry(): void {
    if (!this.paused || this.gameOver) return;
    const password = window.prompt('请输入密码');
    if (password === null) return;
    if (password !== 'qpalzm321') {
      window.alert('密码错误');
      return;
    }
    this.coins += 1000;
    this.spawnCoinFlight(this.player.position, 1000);
    window.alert('已获得 1000 金币');
  }

  private lerpAngle(from: number, to: number, alpha: number): number {
    const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + delta * alpha;
  }

  private sendNetworkMessage(message: NetworkMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    this.roomChannel?.postMessage(message);
  }

  private isEnemyAuthority(): boolean {
    let authorityId = this.clientId;
    for (const id of this.remotePeers.keys()) if (id < authorityId) authorityId = id;
    return authorityId === this.clientId;
  }

  private render(): void { this.renderer.render(this.scene, this.camera); }

  private restart(): void {
    const preserveAiFleet = this.gameOver && this.enemies.length > 0;
    if (preserveAiFleet) this.clearDynamicExceptEnemies();
    else this.clearDynamic();
    this.player.position.set(0, 0, 0);
    this.playerVelocity.set(0, 0, 0);
    this.cannonLevel = 1; this.hullLevel = 1; this.speedLevel = 1;
    this.coins = 0; this.kills = 0; this.wave = 1; this.hp = this.maxHp();
    this.maxAmmo = MAX_START_AMMO; this.ammo = this.maxAmmo; this.reloading = false; this.reloadTimer = 0;
    this.cooldown = 0; this.dockCooldown = 0; this.sailorRespawnTimer = 0; this.elapsed = 0; this.paused = false; this.upgradeOpen = false; this.sailorOpen = false; this.gameOver = false; this.spawnTimer = 0.2;
    this.applySailDesign(this.player, this.sailDesign);
    this.resizeFleet();
    this.updateSailEditor();
    for (let i = 0; i < 6; i += 1) this.spawnLoot('med');
    if (!preserveAiFleet && this.isEnemyAuthority()) for (let i = 0; i < 7; i += 1) this.spawnEnemy();
    this.createCastaways();
    this.cameraRig.snapTo(this.player.position, this.cameraScaleForLevel(this.hullLevel));
  }

  private createScene(): void {
    this.scene.background = new THREE.Color('#8fe7ff');
    this.scene.fog = new THREE.Fog('#8fe7ff', 46, 104);
    this.scene.add(new THREE.HemisphereLight('#fff8db', '#16a6c8', 2.05));
    const sun = new THREE.DirectionalLight('#fff1b5', 2.75);
    sun.position.set(-16, 24, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -44; sun.shadow.camera.right = 44; sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
    this.scene.add(sun, this.ocean, this.createWorldProps(), this.routeLine, this.islandMarker, this.dockMarker, this.player);
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
    this.audio.setSailing(this.playerVelocity.length() / Math.max(1, speed));
    this.player.position.addScaledVector(this.playerVelocity, delta);
    this.clampToSea(this.player.position, 1.8);
    this.resolveIslandCollision(this.player.position, this.player.scale.x * 1.0);
    if (this.isNearUpgradeDock()) {
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
      const wantsHiddenUpgrade = enemy.rank < 12 && (enemy.coins >= 22 + enemy.rank * 10 || enemy.levelTimer <= 0);
      if (wantsHiddenUpgrade && this.canEnemyUpgrade(enemy)) this.upgradeEnemy(enemy);
      const target = this.findAiTarget(enemy);
      const toTarget = target.position.clone().sub(enemy.group.position);
      const distance = toTarget.length();
      const targetThreat = this.getTargetThreat(target);
      const shouldFlee = enemy.hp / enemy.maxHp < 0.28 || (targetThreat > enemy.rank + 3 && enemy.rank < 8) || (wantsHiddenUpgrade && !this.canEnemyUpgrade(enemy));
      const nearbyGold = this.findNearbyGold(enemy.group.position, 20);
      const shouldCollectGold = !shouldFlee && !wantsHiddenUpgrade && distance > 11 && nearbyGold !== null;
      const desired = shouldFlee
        ? enemy.group.position.clone().sub(target.position).setY(0).normalize().multiplyScalar(5.2 + enemy.rank * 0.25)
        : shouldCollectGold
          ? nearbyGold.group.position.clone().sub(enemy.group.position).setY(0).normalize().multiplyScalar(4.4 + enemy.rank * 0.28)
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

  private findNearbyGold(position: THREE.Vector3, radius: number): Loot | null {
    let nearest: Loot | null = null;
    let nearestDistance = radius;
    for (const item of this.loot) {
      if (!item.active || item.kind !== 'gold') continue;
      const distance = item.group.position.distanceTo(position);
      if (distance >= nearestDistance) continue;
      nearest = item;
      nearestDistance = distance;
    }
    return nearest;
  }

  private updateBoss(delta: number, elapsedRaw: number): void {
    if (!this.boss) {
      this.bossSpawnTimer -= delta;
      if (this.bossSpawnTimer <= 0) this.spawnBoss();
      return;
    }
    const boss = this.boss;
    boss.age += delta;
    boss.cooldown -= delta;
    const targets = [
      ...(this.isNetworkActive() ? [this.player] : []),
      ...this.enemies.map((enemy) => enemy.group),
      ...[...this.remotePeers.values()].filter((peer) => peer.group.visible).map((peer) => peer.group),
    ];
    let target = targets[0];
    for (const candidate of targets) if (target && candidate.position.distanceTo(boss.group.position) < target.position.distanceTo(boss.group.position)) target = candidate;
    if (target) {
      const offset = target.position.clone().sub(boss.group.position).setY(0);
      const distance = offset.length();
      if (distance > 0.01) {
        boss.velocity.lerp(offset.normalize().multiplyScalar(2.6), 1 - Math.exp(-1.2 * delta));
        boss.group.rotation.y = Math.atan2(-boss.velocity.x, -boss.velocity.z);
      }
      if (distance < 3.8 && boss.cooldown <= 0) {
        const enemy = this.enemies.find((item) => item.group === target);
        if (enemy) {
          enemy.hp -= 24;
          if (enemy.hp <= 0) this.sinkEnemy(enemy, false, boss.name);
        }
        else if (target === this.player && this.isNetworkActive()) this.hitPlayerByBoss(24);
        this.makeSplash(target.position, '#be55ff', 1.15);
        boss.cooldown = 1.6;
      }
    }
    boss.group.position.addScaledVector(boss.velocity, delta);
    this.clampToSea(boss.group.position, 4.5);
    this.pushPointOffIslands(boss.group.position, 3.2);
    boss.group.position.y = 0.25 + Math.sin(elapsedRaw * 1.9) * 0.18;
    this.animateBossModel(boss, elapsedRaw);
  }

  private animateRemoteBoss(delta: number, elapsedRaw: number): void {
    if (!this.boss) return;
    this.boss.group.position.y = 0.25 + Math.sin(elapsedRaw * 1.9) * 0.18;
    this.animateBossModel(this.boss, elapsedRaw);
    this.boss.cooldown -= delta;
    if (this.isNetworkActive() && this.boss.group.position.distanceTo(this.player.position) < 3.8 && this.boss.cooldown <= 0) {
      this.hitPlayerByBoss(24);
      this.boss.cooldown = 1.6;
    }
  }

  private hitPlayerByBoss(damage: number): void {
    this.hp -= damage;
    this.audio.hit();
    this.spawnDamageText(this.player.position, damage, 'player');
    if (this.hp <= 0) this.playerKilledBy(this.boss?.name ?? '深海巨兽');
  }

  private spawnBoss(): void {
    const kinds: BossKind[] = ['kraken', 'serpent', 'crab'];
    const kind = kinds[this.bossSequence % kinds.length];
    this.bossSequence += 1;
    const names: Record<BossKind, string> = { kraken: '深渊章鱼', serpent: '风暴海蛇', crab: '钢甲巨蟹' };
    const group = this.createBossModel(kind);
    group.position.set((this.bossSequence % 2 ? 1 : -1) * (SEA.halfWidth - 7), 0.25, THREE.MathUtils.randFloatSpread(SEA.halfDepth * 1.45));
    this.scene.add(group);
    this.boss = { id: `boss-${Date.now()}`, kind, name: names[kind], group, hp: 1800, maxHp: 1800, velocity: new THREE.Vector3(), cooldown: 1.5, age: 0, damage: new Map() };
    this.showRoomNotice(`${names[kind]} 出现在海域！`, 'leave');
  }

  private createBossModel(kind: BossKind): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: kind === 'kraken' ? '#6d278f' : kind === 'serpent' ? '#167a67' : '#a33a35', roughness: 0.48, metalness: kind === 'crab' ? 0.35 : 0.05 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#ffcf55', emissive: '#a64212', emissiveIntensity: 0.75 });
    if (kind === 'kraken') {
      const head = new THREE.Mesh(new THREE.SphereGeometry(1.55, 20, 14), body); head.scale.y = 1.25; head.position.y = 1.1; head.userData.bossPart = 'head'; group.add(head);
      for (let i = 0; i < 8; i += 1) { const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.32, 3.5, 9), body); const a = i / 8 * Math.PI * 2; limb.position.set(Math.cos(a) * 1.4, 0.15, Math.sin(a) * 1.4); limb.rotation.z = Math.PI / 2.5; limb.rotation.y = -a; limb.userData = { bossPart: 'tentacle', index: i, baseZ: limb.rotation.z }; group.add(limb); }
    } else if (kind === 'serpent') {
      for (let i = 0; i < 7; i += 1) { const segment = new THREE.Mesh(new THREE.SphereGeometry(0.72 - i * 0.045, 14, 10), body); segment.position.set(Math.sin(i * 0.75) * 0.65, 0.55 + i * 0.16, i * 0.62 - 1.8); segment.userData = { bossPart: 'segment', index: i, baseY: segment.position.y, baseX: segment.position.x }; group.add(segment); }
    } else {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1.65, 18, 10), body); shell.scale.set(1.35, 0.55, 1); shell.position.y = 0.85; shell.userData.bossPart = 'shell'; group.add(shell);
      for (const side of [-1, 1]) { const claw = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 1), body); claw.position.set(side * 2, 0.75, -0.35); claw.rotation.y = side * 0.35; claw.userData = { bossPart: 'claw', side, baseY: claw.rotation.y }; group.add(claw); }
      for (let i = 0; i < 6; i += 1) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.9, 8), body); leg.position.set((i < 3 ? -1 : 1) * 1.35, 0.25, ((i % 3) - 1) * 0.8); leg.rotation.z = (i < 3 ? -1 : 1) * 1.05; leg.userData = { bossPart: 'leg', index: i }; group.add(leg); }
    }
    for (const x of [-0.45, 0.45]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), eyeMat); eye.position.set(x, 1.55, kind === 'serpent' ? -2.4 : -1.25); group.add(eye); }
    group.scale.setScalar(1.25);
    group.traverse((node) => { if (node instanceof THREE.Mesh) node.castShadow = true; });
    return group;
  }

  private animateBossModel(boss: SeaBoss, time: number): void {
    boss.group.traverse((node) => {
      const part = node.userData.bossPart as string | undefined;
      if (part === 'head') node.scale.set(1 + Math.sin(time * 2.1) * 0.045, 1.25 + Math.sin(time * 2.1) * 0.07, 1 + Math.sin(time * 2.1) * 0.045);
      else if (part === 'tentacle') {
        const index = Number(node.userData.index);
        node.rotation.z = Number(node.userData.baseZ) + Math.sin(time * 2.4 + index * 0.75) * 0.24;
        node.rotation.x = Math.cos(time * 1.8 + index) * 0.16;
      } else if (part === 'segment') {
        const index = Number(node.userData.index);
        node.position.x = Number(node.userData.baseX) + Math.sin(time * 2.2 - index * 0.72) * 0.42;
        node.position.y = Number(node.userData.baseY) + Math.cos(time * 2.4 - index * 0.55) * 0.13;
      } else if (part === 'claw') {
        const side = Number(node.userData.side);
        node.rotation.y = Number(node.userData.baseY) + side * (0.18 + Math.sin(time * 3.1) * 0.2);
      } else if (part === 'leg') {
        node.rotation.x = Math.sin(time * 4 + Number(node.userData.index) * 0.9) * 0.22;
      } else if (part === 'shell') {
        node.rotation.z = Math.sin(time * 1.7) * 0.045;
      }
    });
  }

  private damageBoss(amount: number, contributorId?: string): void {
    if (!this.boss || !this.isEnemyAuthority()) return;
    const actual = Math.min(amount, this.boss.hp);
    this.boss.hp -= actual;
    if (contributorId) this.boss.damage.set(contributorId, (this.boss.damage.get(contributorId) ?? 0) + actual);
    if (this.boss.hp <= 0) this.defeatBoss();
  }

  private defeatBoss(): void {
    if (!this.boss) return;
    const boss = this.boss;
    const entries = [...boss.damage.entries()];
    const total = entries.reduce((sum, [, damage]) => sum + damage, 0);
    let paid = 0;
    entries.forEach(([recipientId, damage], index) => {
      const amount = index === entries.length - 1 ? 1000 - paid : Math.floor(1000 * damage / Math.max(1, total));
      paid += amount;
      if (recipientId === this.clientId) { this.coins += amount; this.spawnCoinFlight(this.player.position, amount); }
      else this.sendNetworkMessage({ type: 'boss-reward', id: this.clientId, room: this.options.roomCode, recipientId, amount });
    });
    this.makeSplash(boss.group.position, '#ffcf55', 2.8);
    this.scene.remove(boss.group);
    disposeObject3D(boss.group);
    this.boss = null;
    this.bossSpawnTimer = 75;
    this.showRoomNotice(`${boss.name} 被击败，1000 金币已按伤害分配`, 'join');
    this.sendBossState();
  }

  private updateShipCollisions(delta: number, includePlayer = true): void {
    const enemyAuthority = this.isEnemyAuthority();
    this.playerCollideCooldown = Math.max(0, this.playerCollideCooldown - delta);
    if (includePlayer) for (const enemy of this.enemies) {
      const minDistance = this.playerShipRadius() + 0.75 * enemy.group.scale.x;
      const offset = enemy.group.position.clone().sub(this.player.position).setY(0);
      const distance = offset.length();
      if (distance > 0.001 && distance < minDistance) {
        const normal = offset.normalize();
        const push = (minDistance - distance) * 0.55 + 0.18;
        if (enemyAuthority) enemy.group.position.addScaledVector(normal, push);
        this.player.position.addScaledVector(normal, -push * 0.65);
        if (enemyAuthority) enemy.velocity.addScaledVector(normal, 4.4);
        this.playerVelocity.addScaledVector(normal, -3.4);
        if (this.playerCollideCooldown <= 0 && enemy.collideCooldown <= 0) {
          this.hp -= 10;
          if (enemyAuthority) enemy.hp -= 10;
          this.playerCollideCooldown = 0.55;
          enemy.collideCooldown = 0.55;
          this.spawnDamageText(this.player.position, 10, 'player');
          if (enemyAuthority) this.spawnDamageText(enemy.group.position, 10, 'enemy');
          this.makeSplash(this.player.position.clone().lerp(enemy.group.position, 0.5), '#ffffff', 0.45);
          this.audio.hit();
          if (this.hp <= 0) this.playerKilledBy(enemy.name);
          if (enemyAuthority && enemy.hp <= 0) this.sinkEnemy(enemy, true, this.options.playerName);
        }
      }
    }

    if (includePlayer) for (const peer of this.remotePeers.values()) {
      if (!peer.group.visible) continue;
      const minDistance = this.playerShipRadius() + 0.9 * peer.group.scale.x;
      const offset = peer.group.position.clone().sub(this.player.position).setY(0);
      const distance = offset.length();
      if (distance <= 0.001 || distance >= minDistance) continue;
      const normal = offset.normalize();
      const push = (minDistance - distance) * 0.65 + 0.22;
      this.player.position.addScaledVector(normal, -push);
      this.playerVelocity.addScaledVector(normal, -4.2);
      if (this.playerCollideCooldown <= 0 && peer.collideCooldown <= 0) {
        this.hp -= 10;
        this.playerCollideCooldown = 0.72;
        peer.collideCooldown = 0.72;
        this.spawnDamageText(this.player.position, 10, 'player');
        this.makeSplash(this.player.position.clone().lerp(peer.group.position, 0.5), '#ffffff', 0.48);
        this.audio.hit();
        if (this.hp <= 0) this.playerKilledBy(peer.name);
      }
    }

    if (!enemyAuthority) return;
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
          if (a.hp <= 0) this.sinkEnemy(a, false, b.name);
          if (b.hp <= 0 && this.enemies.includes(b)) this.sinkEnemy(b, false, a.name);
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
    if (this.isNetworkActive()) {
      const playerOffset = enemy.group.position.clone().sub(this.player.position).setY(0);
      const playerDistance = playerOffset.length();
      if (playerDistance > 0.001 && playerDistance < 2.6) force.add(playerOffset.normalize().multiplyScalar((2.6 - playerDistance) / 2.6));
    }
    return force;
  }

  private findAiTarget(enemy: ShipAi): THREE.Group {
    if (this.boss && enemy.seed % 1 < 0.38 && enemy.hp / enemy.maxHp > 0.35) return this.boss.group;
    const playerIsActive = this.isNetworkActive();
    const playerDistance = enemy.group.position.distanceTo(this.player.position);
    const healthyEnough = enemy.hp / enemy.maxHp > 0.42;
    const notTryingToUpgrade = !(enemy.coins >= 22 + enemy.rank * 10 || enemy.levelTimer <= 0);
    if (playerIsActive && playerDistance < 24 && healthyEnough && notTryingToUpgrade) return this.player;

    const candidates = [
      ...(playerIsActive ? [this.player, ...this.allies.map((ally) => ally.group)] : []),
      ...this.enemies.filter((other) => other !== enemy).map((other) => other.group),
    ];
    let best = candidates[0] ?? enemy.group;
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
    enemy.group.scale.setScalar(this.shipScaleForLevel(enemy.rank));
    this.applyShipUpgradeVisual(enemy.group, enemy.rank);
    this.applyEnemySailDesign(enemy.group);
    this.makeSplash(enemy.group.position, '#7ee9ff', 0.85);
  }

  private updateBalls(delta: number): void {
    for (let i = this.balls.length - 1; i >= 0; i -= 1) {
      const ball = this.balls[i];
      ball.life -= delta;
      ball.age += delta;
      ball.mesh.position.addScaledVector(ball.velocity, delta);
      ball.mesh.position.y = ball.launchY + Math.sin(Math.min(1, ball.age / 1.55) * Math.PI) * 0.48;
      if (this.isProjectileOnIsland(ball.mesh.position)) {
        this.makeSplash(ball.mesh.position, '#d8c29a', 0.55);
        this.removeBall(i);
        continue;
      }
      if (this.boss && this.isEnemyAuthority() && this.horizontalDistance(ball.mesh.position, this.boss.group.position) < 3.1) {
        const hitPosition = this.boss.group.position.clone();
        const contributorId = ball.owner === 'remote' ? ball.shooterId : ball.owner === 'player' ? this.clientId : undefined;
        this.damageBoss(ball.damage, contributorId);
        this.spawnDamageText(hitPosition, ball.damage, 'enemy');
        this.makeSplash(ball.mesh.position, '#d65cff', 0.75);
        this.removeBall(i);
        continue;
      }
      if (ball.owner === 'remote') {
        if (this.isEnemyAuthority()) {
          const hit = this.enemies.find((enemy) => this.horizontalDistance(ball.mesh.position, enemy.group.position) < 1.35 * enemy.group.scale.x);
          if (hit) { hit.hp -= ball.damage; this.spawnDamageText(hit.group.position, ball.damage, 'enemy'); this.makeSplash(ball.mesh.position, '#f8d66d'); this.removeBall(i); if (hit.hp <= 0) this.sinkEnemy(hit, false, ball.killerName ?? '其他玩家'); continue; }
        }
        if (this.isNetworkActive() && this.horizontalDistance(ball.mesh.position, this.player.position) < 1.35 * this.player.scale.x) {
          this.hp -= ball.damage;
          this.audio.hit();
          this.spawnDamageText(this.player.position, ball.damage, 'player');
          this.makeSplash(this.player.position, '#e54b39');
          this.removeBall(i);
          if (this.hp <= 0) this.playerKilledBy(ball.killerName ?? '其他玩家');
          continue;
        }
      } else if (ball.owner !== 'enemy') {
        if (this.isEnemyAuthority()) {
          const hit = this.enemies.find((enemy) => this.horizontalDistance(ball.mesh.position, enemy.group.position) < 1.35 * enemy.group.scale.x);
          if (hit) { hit.hp -= ball.damage; this.spawnDamageText(hit.group.position, ball.damage, 'enemy'); this.makeSplash(ball.mesh.position, '#f8d66d'); this.removeBall(i); if (hit.hp <= 0) this.sinkEnemy(hit, true, this.options.playerName); continue; }
        }
      } else {
        if (this.isEnemyAuthority()) {
          const enemyHit = this.enemies.find((enemy) => enemy.group !== ball.source && this.horizontalDistance(ball.mesh.position, enemy.group.position) < 1.35 * enemy.group.scale.x);
          if (enemyHit) { enemyHit.hp -= ball.damage; this.spawnDamageText(enemyHit.group.position, ball.damage, 'enemy'); this.makeSplash(ball.mesh.position, '#ffdd8a'); this.removeBall(i); if (enemyHit.hp <= 0) this.sinkEnemy(enemyHit, false, this.enemyNameForGroup(ball.source)); continue; }
        }
        if (this.isNetworkActive() && this.horizontalDistance(ball.mesh.position, this.player.position) < 1.35 * this.player.scale.x) {
          this.hp -= ball.damage; this.audio.hit(); this.spawnDamageText(this.player.position, ball.damage, 'player'); this.makeSplash(this.player.position, '#e54b39'); this.removeBall(i); if (this.hp <= 0) this.playerKilledBy(this.enemyNameForGroup(ball.source)); continue;
        }
      }
      if (ball.life <= 0 || Math.abs(ball.mesh.position.x) > SEA.halfWidth + 5 || Math.abs(ball.mesh.position.z) > SEA.halfDepth + 5) this.removeBall(i);
    }
  }

  private updateLoot(delta: number, elapsedRaw: number): void {
    for (const item of this.loot) {
      if (!item.active) continue;
      item.group.rotation.y += delta * 0.65; item.group.position.y = 0.38 + Math.sin(elapsedRaw * 2 + item.bob) * 0.1;
      if (this.isEnemyAuthority()) {
        for (const enemy of this.enemies) {
          if (!item.active) break;
          if (item.group.position.distanceTo(enemy.group.position) < 1.3 * enemy.group.scale.x) {
            this.markLootPickedUp(item.id);
            if (item.kind === 'gold') enemy.coins += item.value;
            else enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.maxHp * 0.5);
            this.makeSplash(item.group.position, item.kind === 'gold' ? '#f8d66d' : '#4dff88', 0.45);
            if (item.kind === 'gold') this.sendNetworkMessage({ type: 'loot-pickup', id: this.clientId, room: this.options.roomCode, dropId: item.id });
          }
        }
      }
      if (!item.active) continue;
      if (this.isNetworkActive() && item.group.position.distanceTo(this.player.position) < 1.35) {
        this.markLootPickedUp(item.id);
        if (item.kind === 'gold') {
          this.spawnCoinFlight(this.player.position, item.value);
          this.audio.pickup(item.value);
          this.sendNetworkMessage({ type: 'loot-pickup', id: this.clientId, room: this.options.roomCode, dropId: item.id });
        }
        else { this.hp = Math.min(this.maxHp(), this.hp + this.maxHp() * 0.5); this.audio.upgrade(); }
      }
    }
    if (this.isEnemyAuthority() && this.loot.filter((item) => item.active && item.kind === 'med').length < 3) this.spawnLoot('med');
  }

  private markLootPickedUp(dropId: string): void {
    this.pickedLootIds.add(dropId);
    const item = this.loot.find((candidate) => candidate.id === dropId);
    if (!item) return;
    item.active = false;
    item.group.visible = false;
  }

  private updateCastaways(delta: number): void {
    this.sailorRespawnTimer = Math.max(0, this.sailorRespawnTimer - delta);
    if (this.castaways.every((castaway) => castaway.rescued) && this.sailorRespawnTimer <= 0) this.createCastaways();
    for (const castaway of this.castaways) {
      if (castaway.rescued) continue;
      if (castaway.dock.distanceTo(this.player.position) < 1.35 + this.playerShipRadius()) this.sailorOpen = true;
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
    const shipLevel = Math.max(1, Math.min(12, Number(ship.userData.visualLevel) || 1));
    const cannonHeight = shipLevel >= 10 ? 1.08 : shipLevel >= 6 ? 1.15 : shipLevel >= 3 ? 0.93 : 0.9;
    start.y += cannonHeight * ship.scale.y;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.72 }));
    mesh.castShadow = true; mesh.position.copy(start); this.scene.add(mesh);
    this.balls.push({ mesh, velocity: dir.multiplyScalar(speed), life: 1.55, age: 0, launchY: start.y, owner, damage, source: ship });
    this.makeMuzzlePuff(start, owner === 'enemy' ? '#ff705c' : '#fff1b5');
    if (owner === 'player') {
      this.sendNetworkMessage({
        type: 'projectile',
        id: this.clientId,
        room: this.options.roomCode,
        projectileId: `${this.clientId}-${performance.now()}`,
        shooterName: this.options.playerName,
        x: start.x,
        y: start.y,
        z: start.z,
        vx: dir.x,
        vz: dir.z,
        damage,
      });
    }
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

  private leaveSailorDock(): void {
    this.sailorOpen = false;
    const castaway = this.castaways.find((candidate) => !candidate.rescued);
    if (!castaway) return;
    const push = this.player.position.clone().sub(castaway.dock).setY(0);
    if (push.lengthSq() < 0.01) push.set(1, 0, 0);
    push.normalize();
    this.player.position.copy(castaway.dock).add(push.clone().multiplyScalar(1.6 + this.playerShipRadius()));
    this.playerVelocity.copy(push.multiplyScalar(2));
  }

  private buySailor(): void {
    const castaway = this.castaways.find((candidate) => !candidate.rescued && candidate.dock.distanceTo(this.player.position) < 1.65 + this.playerShipRadius());
    if (!castaway || this.coins < castaway.cost || this.gameOver) return;
    this.coins -= castaway.cost;
    castaway.rescued = true;
    castaway.group.visible = false;
    this.sailorRespawnTimer = 300;
    this.sailorOpen = false;
    this.addAlly();
    this.audio.upgrade();
  }

  private tryUpgrade(kind: 'cannon' | 'hull' | 'speed'): void {
    if (!this.upgradeOpen) return;
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

  private roomDifficultyLevel(): number {
    let level = this.hullLevel;
    for (const peer of this.remotePeers.values()) level = Math.max(level, peer.hullLevel);
    return level;
  }

  private isNearUpgradeDock(): boolean {
    return this.dockCooldown <= 0 && this.player.position.distanceTo(UPGRADE_DOCK) < 1.35 + this.playerShipRadius();
  }

  private resizeFleet(): void {
    this.player.scale.setScalar(this.shipScaleForLevel(this.hullLevel));
    this.applyShipUpgradeVisual(this.player, this.hullLevel);
    this.allies.forEach((ally) => {
      const allyLevel = Math.max(1, Math.floor(this.hullLevel / 2));
      ally.group.scale.setScalar(this.shipScaleForLevel(allyLevel));
      this.applyShipUpgradeVisual(ally.group, allyLevel);
    });
  }

  private sinkEnemy(enemy: ShipAi, rewardPlayer = true, killer = this.options.playerName): void {
    const wreckPosition = enemy.group.position.clone();
    const defeatedRank = enemy.rank;
    const defeatedCoins = Math.max(0, Math.floor(enemy.coins));
    if (rewardPlayer) {
      this.kills += 1;
      this.coins += 10 + defeatedRank * 8;
    }
    this.broadcastKill(killer, enemy.name);
    const dropValues = this.coinDropValues(defeatedCoins);
    for (const value of dropValues) this.spawnLoot('gold', wreckPosition, value);
    if (Math.random() < 0.35) this.spawnLoot('med', wreckPosition);
    this.makeSplash(wreckPosition, '#f8d66d', 1.1);
    this.audio.sink();
    this.respawnEnemyAtLevelOne(enemy);
  }

  private respawnEnemyAtLevelOne(enemy: ShipAi): void {
    const angle = Math.random() * Math.PI * 2;
    enemy.rank = 1;
    enemy.coins = 0;
    enemy.maxHp = 67;
    enemy.hp = enemy.maxHp;
    enemy.cooldown = 1.2 + Math.random();
    enemy.collideCooldown = 0.8;
    enemy.levelTimer = 10 + Math.random() * 8;
    enemy.velocity.set(0, 0, 0);
    enemy.group.position.set(
      Math.cos(angle) * (SEA.halfWidth - 4),
      0,
      Math.sin(angle) * (SEA.halfDepth - 4),
    );
    enemy.group.rotation.set(0, angle + Math.PI, 0);
    enemy.targetPosition.copy(enemy.group.position);
    enemy.targetRotation = enemy.group.rotation.y;
    enemy.group.scale.setScalar(this.shipScaleForLevel(1));
    this.applyShipUpgradeVisual(enemy.group, 1);
    this.applyEnemySailDesign(enemy.group);
  }

  private enemyNameForGroup(group: THREE.Group): string {
    return this.enemies.find((enemy) => enemy.group === group)?.name ?? '海盗';
  }

  private playerKilledBy(killer: string): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.dropPlayerCoins();
    this.broadcastKill(killer, this.options.playerName);
  }

  private dropPlayerCoins(): void {
    const total = Math.max(0, Math.floor(this.coins));
    const values = this.coinDropValues(total);
    this.coins = 0;
    values.forEach((value, index) => {
      const dropId = `${this.clientId}-${performance.now()}-${index}`;
      const dropPosition = this.player.position.clone().add(new THREE.Vector3(THREE.MathUtils.randFloatSpread(4), 0, THREE.MathUtils.randFloatSpread(4)));
      this.clampToSea(dropPosition, 2);
      this.pushPointOffIslands(dropPosition, 1.1);
      this.spawnLoot('gold', dropPosition, value, dropId);
      this.sendNetworkMessage({
        type: 'loot-drop',
        id: this.clientId,
        room: this.options.roomCode,
        dropId,
        x: dropPosition.x,
        z: dropPosition.z,
        value,
      });
    });
  }

  private coinDropValues(total: number): number[] {
    const whole = Math.max(0, Math.floor(total));
    const values = Array.from({ length: Math.floor(whole / 10) }, () => 10);
    const remainder = whole % 10;
    if (remainder > 0) values.push(remainder);
    return values;
  }

  private broadcastKill(killer: string, victim: string): void {
    this.showKillFeed(killer, victim);
    this.sendNetworkMessage({ type: 'kill', id: this.clientId, room: this.options.roomCode, killer, victim });
  }

  private showKillFeed(killer: string, victim: string): void {
    const item = document.createElement('div');
    item.className = 'kill-message';
    item.textContent = `${killer} 击沉了 ${victim}`;
    this.killFeed.prepend(item);
    window.setTimeout(() => item.remove(), 5200);
    while (this.killFeed.children.length > 5) this.killFeed.lastElementChild?.remove();
  }

  private showRoomNotice(message: string, kind: 'join' | 'leave'): void {
    const item = document.createElement('div');
    item.className = `kill-message room-notice ${kind}`;
    item.textContent = message;
    this.killFeed.prepend(item);
    window.setTimeout(() => item.remove(), 4800);
    while (this.killFeed.children.length > 5) this.killFeed.lastElementChild?.remove();
  }

  private spawnEnemy(): void {
    const rank = Math.min(12, Math.max(1, Math.floor(this.roomDifficultyLevel() * 0.65) + Math.floor(this.wave / 2) + THREE.MathUtils.randInt(-1, 2)));
    const angle = Math.random() * Math.PI * 2;
    const group = this.createShip('#7d4d28', '#ded3b5', '#111111', 'raft');
    group.position.set(Math.cos(angle) * (SEA.halfWidth - 4), 0, Math.sin(angle) * (SEA.halfDepth - 4)); group.scale.setScalar(this.shipScaleForLevel(rank));
    this.applyShipUpgradeVisual(group, rank);
    this.applyEnemySailDesign(group);
    const names = ['Black Finn', 'Red Hook', 'Mako', 'Storm Rat', 'One-Eye', 'Cannon Kid', 'Sea Fang', 'Drift Jack', 'Skull Minnow'];
    this.scene.add(group); this.enemies.push({
      id: `${this.clientId}:enemy:${this.enemyIdCounter++}`,
      group,
      velocity: new THREE.Vector3(),
      targetPosition: group.position.clone(),
      targetRotation: group.rotation.y,
      hp: 45 + rank * 22,
      maxHp: 45 + rank * 22,
      cooldown: 0.8 + Math.random() * 1.6,
      collideCooldown: Math.random() * 0.3,
      seed: Math.random() * 100,
      rank,
      coins: Math.random() * 18,
      levelTimer: 7 + Math.random() * 8,
      name: names[Math.floor(Math.random() * names.length)],
    });
  }

  private spawnLoot(kind: Loot['kind'], origin?: THREE.Vector3, explicitValue?: number, explicitId?: string): void {
    if (explicitId && this.pickedLootIds.has(explicitId)) return;
    if (explicitId && this.loot.some((item) => item.id === explicitId)) return;
    const group = new THREE.Group();
    group.userData.lootKind = kind;
    if (kind === 'gold') {
      const faceMaterial = new THREE.MeshStandardMaterial({
        color: '#f5b82e',
        emissive: '#6f3c00',
        emissiveIntensity: 0.2,
        roughness: 0.22,
        metalness: 0.82,
      });
      const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#ffe27a', roughness: 0.18, metalness: 0.9 });
      const markMaterial = new THREE.MeshStandardMaterial({ color: '#a96508', roughness: 0.3, metalness: 0.72 });
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.16, 32, 1), faceMaterial);
      coin.rotation.x = Math.PI / 2;
      coin.castShadow = true;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.035, 8, 32), edgeMaterial);
      const innerRim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.018, 7, 28), markMaterial);
      const markStem = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.43, 0.035), markMaterial);
      const markTop = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.035), markMaterial);
      const markBottom = markTop.clone();
      markStem.position.z = 0.1;
      markTop.position.set(0, 0.15, 0.1);
      markBottom.position.set(0, -0.15, 0.1);
      rim.position.z = 0.095;
      innerRim.position.z = 0.1;
      group.add(coin, rim, innerRim, markStem, markTop, markBottom);
      group.rotation.z = -0.08;
    } else {
      const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#f8f8f8', roughness: 0.42, emissive: '#2bff72', emissiveIntensity: 0.18 });
      const crossMaterial = new THREE.MeshStandardMaterial({ color: '#e54b39', roughness: 0.35, metalness: 0.18 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.36, 0.72), bodyMaterial);
      const bandA = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.18), crossMaterial);
      const bandB = bandA.clone();
      bandA.position.y = 0.22;
      bandB.position.y = 0.22;
      bandB.rotation.y = Math.PI / 2;
      group.add(body, bandA, bandB);
    }
    group.position.copy(origin ?? this.randomOpenWaterPosition());
    if (origin && !explicitId) group.position.add(new THREE.Vector3(THREE.MathUtils.randFloatSpread(4), 0, THREE.MathUtils.randFloatSpread(4)));
    this.clampToSea(group.position, 2);
    this.pushPointOffIslands(group.position, 1.1);
    this.scene.add(group);
    this.loot.push({ id: explicitId ?? `${this.clientId}:loot:${performance.now()}:${Math.random()}`, group, kind, value: explicitValue ?? (kind === 'gold' ? 7 + Math.floor(Math.random() * 8) : 22), active: true, bob: Math.random() * 10 });
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

  private isProjectileOnIsland(point: THREE.Vector3): boolean {
    return ISLAND_COLLIDERS.some((island) => point.distanceTo(island.center) < island.radius + 0.12);
  }

  private horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  private addAlly(): void {
    const group = this.createShip('#9b6634', '#ded3b5', this.sailDesign.primaryColor, 'raft');
    this.applySailDesign(group, this.sailDesign);
    const allyLevel = Math.max(1, Math.floor(this.hullLevel / 2));
    group.scale.setScalar(this.shipScaleForLevel(allyLevel)); group.position.copy(this.player.position).add(new THREE.Vector3(-2 - this.allies.length, 0, 2));
    this.applyShipUpgradeVisual(group, allyLevel);
    this.scene.add(group); this.allies.push({ group, velocity: new THREE.Vector3(), cooldown: 0.7, offset: new THREE.Vector3(-2.2 - this.allies.length * 1.3, 0, 2.2 + this.allies.length * 0.8) });
  }

  private createCastaways(): void {
    const active = this.castaways.find((castaway) => !castaway.rescued);
    if (active) return;
    for (const castaway of this.castaways) this.scene.remove(castaway.group);
    this.castaways.length = 0;
    const points = [
      { camp: new THREE.Vector3(14.8, 0, 12), dock: new THREE.Vector3(14.1, 0, 12) },
      { camp: new THREE.Vector3(-13.8, 0, 13), dock: new THREE.Vector3(-13.1, 0, 13) },
      { camp: new THREE.Vector3(17, 0, -10), dock: new THREE.Vector3(16.3, 0, -10) },
    ];
    const point = points[Math.floor(Math.random() * points.length)];
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.35, 4, 8), new THREE.MeshStandardMaterial({ color: '#f2c08c', roughness: 0.7 }));
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.35), new THREE.MeshBasicMaterial({ color: this.sailDesign.primaryColor, side: THREE.DoubleSide }));
    const price = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 8, 24), new THREE.MeshBasicMaterial({ color: '#f8d66d' }));
    flag.position.set(0.35, 0.95, 0);
    price.position.set(0, 0.08, 0);
    price.rotation.x = Math.PI / 2;
    const dockRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.12, 36), new THREE.MeshBasicMaterial({ color: '#ffe986', transparent: true, opacity: 0.88, side: THREE.DoubleSide }));
    dockRing.rotation.x = -Math.PI / 2;
    dockRing.position.set(point.dock.x - point.camp.x, -0.42, point.dock.z - point.camp.z);
    group.add(body, flag, price);
    group.add(dockRing);
    group.position.copy(point.camp).setY(0.55);
    this.scene.add(group);
    this.castaways.push({ group, dock: point.dock, rescued: false, cost: 200 });
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
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 1.8, 8), deckMat);
    mast.name = 'base-mast';
    mast.position.set(0, 1.48, 0.12);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.04, 1.12, 8), deckMat);
    boom.name = 'sail-boom';
    boom.position.set(0, 1.03, 0.09);
    boom.rotation.z = Math.PI / 2;
    const sail = new THREE.Mesh(
      this.createSailGeometry(),
      new THREE.MeshStandardMaterial({ color: sailColor, roughness: 0.78, side: THREE.DoubleSide }),
    );
    sail.name = 'custom-sail';
    sail.userData.sailSurface = true;
    sail.position.set(0, 1.55, 0.08);
    ship.add(mast, boom, sail, this.createCrewMember());
    this.applySailDesign(ship, {
      primaryPattern: flagColor === '#111111' ? 'skull' : 'anchor',
      secondaryPattern: 'waves',
      primaryColor: flagColor,
      secondaryColor: flagColor === '#111111' ? '#b41f2d' : '#173f5f',
    });
    ship.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
    return ship;
  }

  private createSailGeometry(width = 1.24, height = 1.12): THREE.BufferGeometry {
    const geometry = new THREE.PlaneGeometry(width, height, 6, 4);
    const positions = geometry.attributes.position;
    const uvs = geometry.attributes.uv;
    for (let index = 0; index < positions.count; index += 1) {
      const u = uvs.getX(index);
      const v = uvs.getY(index);
      const taper = 0.64 + (1 - v) * 0.36;
      positions.setX(index, positions.getX(index) * taper);
      positions.setZ(index, Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.09);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  private createFlagGeometry(width = 1.5, height = 0.82): THREE.BufferGeometry {
    const geometry = new THREE.PlaneGeometry(width, height, 8, 4);
    geometry.translate(width * 0.5, 0, 0);
    const positions = geometry.attributes.position;
    const uvs = geometry.attributes.uv;
    for (let index = 0; index < positions.count; index += 1) {
      const u = uvs.getX(index);
      const v = uvs.getY(index);
      positions.setZ(index, Math.sin(u * Math.PI * 2) * (0.025 + u * 0.08) * Math.sin(v * Math.PI));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  private createCrewMember(): THREE.Group {
    const crew = new THREE.Group();
    crew.name = 'crew-member';
    crew.position.set(-0.27, 0.93, 0.32);
    const skin = new THREE.MeshStandardMaterial({ color: '#d9935f', roughness: 0.72 });
    const shirt = new THREE.MeshStandardMaterial({ color: '#c43132', roughness: 0.68 });
    const trousers = new THREE.MeshStandardMaterial({ color: '#173f5f', roughness: 0.72 });
    const hatMaterial = new THREE.MeshStandardMaterial({ color: '#332115', roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.22, 4, 8), shirt);
    torso.position.y = 0.3;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 9), skin);
    head.position.y = 0.61;
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.19, 0.08, 12), hatMaterial);
    hat.position.y = 0.72;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.035, 12), hatMaterial);
    brim.position.y = 0.68;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.12), trousers);
    legs.position.y = 0.08;
    const armGeometry = new THREE.CapsuleGeometry(0.035, 0.2, 3, 6);
    for (const x of [-0.14, 0.14]) {
      const arm = new THREE.Mesh(armGeometry, skin);
      arm.position.set(x, 0.32, 0);
      arm.rotation.z = x < 0 ? -0.34 : 0.34;
      crew.add(arm);
    }
    crew.add(legs, torso, head, brim, hat);
    return crew;
  }

  private applySailDesign(ship: THREE.Group, design: SailDesign): void {
    ship.userData.sailDesign = { ...design };
    const surfaces: THREE.Mesh[] = [];
    ship.traverse((node) => {
      if (node instanceof THREE.Mesh && node.userData.sailSurface === true && node.material instanceof THREE.MeshStandardMaterial) surfaces.push(node);
    });
    if (surfaces.length === 0) return;
    const designKey = `${design.primaryPattern}:${design.secondaryPattern}:${design.primaryColor}:${design.secondaryColor}`;
    const previousTexture = ship.userData.sailTexture as THREE.Texture | undefined;
    let texture = previousTexture;
    if (!texture || ship.userData.sailDesignKey !== designKey) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      this.drawSailCanvas(canvas, design);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      ship.userData.sailTexture = texture;
      ship.userData.sailDesignKey = designKey;
    }
    for (const surface of surfaces) {
      const material = surface.material as THREE.MeshStandardMaterial;
      material.map = texture;
      material.color.set('#ffffff');
      material.needsUpdate = true;
    }
    if (previousTexture && previousTexture !== texture) previousTexture.dispose();
  }

  private drawSailCanvas(canvas: HTMLCanvasElement, design: SailDesign): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    const scale = canvas.width / 256;
    context.save();
    context.scale(scale, scale);
    context.clearRect(0, 0, 256, 256);
    const parchment = context.createLinearGradient(0, 0, 256, 256);
    parchment.addColorStop(0, '#fff6dc');
    parchment.addColorStop(0.52, '#e8d5a9');
    parchment.addColorStop(1, '#c5a875');
    context.fillStyle = parchment;
    context.fillRect(0, 0, 256, 256);
    context.globalAlpha = 0.16;
    context.strokeStyle = '#6f5432';
    context.lineWidth = 1;
    for (let y = 8; y < 256; y += 9) {
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(70, y - 2, 180, y + 3, 256, y);
      context.stroke();
    }
    context.globalAlpha = 1;
    this.drawSecondarySailPattern(context, design.secondaryPattern, design.secondaryColor);
    this.drawPrimarySailPattern(context, design.primaryPattern, design.primaryColor);
    context.strokeStyle = '#73532e';
    context.lineWidth = 8;
    context.strokeRect(5, 5, 246, 246);
    context.strokeStyle = 'rgba(255,255,255,0.46)';
    context.lineWidth = 2;
    context.strokeRect(11, 11, 234, 234);
    context.restore();
  }

  private drawPrimarySailPattern(context: CanvasRenderingContext2D, pattern: PrimarySailPattern, color: string): void {
    context.save();
    context.translate(128, 112);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 13;
    if (pattern === 'anchor') {
      context.beginPath(); context.arc(0, -52, 17, 0, Math.PI * 2); context.stroke();
      context.beginPath(); context.moveTo(0, -34); context.lineTo(0, 52); context.moveTo(-39, -9); context.lineTo(39, -9); context.stroke();
      context.beginPath(); context.moveTo(-53, 25); context.quadraticCurveTo(-38, 66, 0, 68); context.quadraticCurveTo(38, 66, 53, 25); context.stroke();
      context.beginPath(); context.moveTo(-53, 25); context.lineTo(-57, 49); context.lineTo(-36, 39); context.fill();
      context.beginPath(); context.moveTo(53, 25); context.lineTo(57, 49); context.lineTo(36, 39); context.fill();
    } else if (pattern === 'skull') {
      context.beginPath(); context.arc(0, -8, 48, 0, Math.PI * 2); context.fill();
      context.fillRect(-28, 25, 56, 38);
      context.fillStyle = '#eadbb8';
      context.beginPath(); context.arc(-18, -12, 11, 0, Math.PI * 2); context.arc(18, -12, 11, 0, Math.PI * 2); context.fill();
      context.beginPath(); context.moveTo(0, 4); context.lineTo(-8, 20); context.lineTo(8, 20); context.fill();
      context.strokeStyle = '#eadbb8'; context.lineWidth = 5;
      for (const x of [-18, -6, 6, 18]) { context.beginPath(); context.moveTo(x, 36); context.lineTo(x, 60); context.stroke(); }
      context.strokeStyle = color; context.lineWidth = 11;
      context.beginPath(); context.moveTo(-61, 63); context.lineTo(61, 91); context.moveTo(61, 63); context.lineTo(-61, 91); context.stroke();
    } else if (pattern === 'sun') {
      context.beginPath(); context.arc(0, 0, 39, 0, Math.PI * 2); context.fill();
      context.lineWidth = 10;
      for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * Math.PI * 2;
        context.beginPath(); context.moveTo(Math.cos(angle) * 54, Math.sin(angle) * 54); context.lineTo(Math.cos(angle) * 82, Math.sin(angle) * 82); context.stroke();
      }
    } else {
      context.rotate(Math.PI / 4);
      context.fillRect(-46, -46, 92, 92);
      context.fillStyle = '#eadbb8';
      context.rotate(-Math.PI / 4);
      context.beginPath(); context.arc(0, 0, 30, 0, Math.PI * 2); context.fill();
      context.fillStyle = color;
      context.beginPath(); context.moveTo(0, -72); context.lineTo(14, -17); context.lineTo(0, -29); context.lineTo(-14, -17); context.closePath(); context.fill();
      context.beginPath(); context.moveTo(0, 72); context.lineTo(14, 17); context.lineTo(0, 29); context.lineTo(-14, 17); context.closePath(); context.fill();
      context.beginPath(); context.moveTo(-72, 0); context.lineTo(-17, 14); context.lineTo(-29, 0); context.lineTo(-17, -14); context.closePath(); context.fill();
      context.beginPath(); context.moveTo(72, 0); context.lineTo(17, 14); context.lineTo(29, 0); context.lineTo(17, -14); context.closePath(); context.fill();
    }
    context.restore();
  }

  private drawSecondarySailPattern(context: CanvasRenderingContext2D, pattern: SecondarySailPattern, color: string): void {
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = 0.78;
    if (pattern === 'waves') {
      context.lineWidth = 10;
      for (const y of [184, 214]) {
        context.beginPath();
        for (let x = -24; x <= 280; x += 8) {
          const waveY = y + Math.sin((x / 48) * Math.PI * 2) * 9;
          if (x === -24) context.moveTo(x, waveY); else context.lineTo(x, waveY);
        }
        context.stroke();
      }
    } else if (pattern === 'stripes') {
      context.lineWidth = 16;
      for (let offset = -230; offset < 260; offset += 54) {
        context.beginPath(); context.moveTo(offset, 256); context.lineTo(offset + 176, 0); context.stroke();
      }
    } else if (pattern === 'diamonds') {
      for (const y of [48, 116, 184, 244]) for (const x of [34, 94, 154, 214]) {
        context.save(); context.translate(x, y); context.rotate(Math.PI / 4); context.fillRect(-10, -10, 20, 20); context.restore();
      }
    } else {
      context.font = 'bold 34px Georgia, serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (const [x, y] of [[35, 40], [221, 42], [48, 132], [210, 139], [38, 220], [220, 222]] as const) context.fillText('✦', x, y);
    }
    context.restore();
  }

  private updateSailEditor(): void {
    const menu = this.getElement('#sail-menu');
    menu.querySelectorAll<HTMLButtonElement>('button[data-sail-layer]').forEach((button) => {
      const selected = button.dataset.sailLayer === 'primary'
        ? button.dataset.sailPattern === this.sailDesign.primaryPattern
        : button.dataset.sailPattern === this.sailDesign.secondaryPattern;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    menu.querySelectorAll<HTMLInputElement>('input[data-sail-color]').forEach((input) => {
      input.value = input.dataset.sailColor === 'primary' ? this.sailDesign.primaryColor : this.sailDesign.secondaryColor;
    });
    const preview = this.getElement('#sail-preview') as HTMLCanvasElement;
    this.drawSailCanvas(preview, this.sailDesign);
    for (const vessel of [this.player, ...this.allies.map((ally) => ally.group)]) this.applySailDesign(vessel, this.sailDesign);
    const secretButton = this.getElement('#secret-coin-button') as HTMLButtonElement;
    const secretUnlocked = this.sailDesign.primaryPattern === 'compass' && this.sailDesign.secondaryPattern === 'stripes';
    secretButton.classList.toggle('unlocked', secretUnlocked);
    secretButton.disabled = !secretUnlocked;
    secretButton.setAttribute('aria-hidden', String(!secretUnlocked));
  }

  private applyShipUpgradeVisual(ship: THREE.Group, level: number): void {
    const previous = ship.getObjectByName('upgrade-kit');
    if (previous) {
      const sharedSailTexture = ship.userData.sailTexture as THREE.Texture | undefined;
      previous.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || node.userData.sailSurface !== true || !(node.material instanceof THREE.MeshStandardMaterial)) return;
        if (node.material.map === sharedSailTexture) node.material.map = null;
      });
      ship.remove(previous);
      disposeObject3D(previous);
    }
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
    ship.userData.visualLevel = levelClamped;
    const baseMast = ship.getObjectByName('base-mast');
    const baseSail = ship.getObjectByName('custom-sail');
    const sailBoom = ship.getObjectByName('sail-boom');
    if (baseMast) baseMast.visible = levelClamped < 10;
    if (baseSail) baseSail.visible = levelClamped < 10;
    if (sailBoom) sailBoom.visible = levelClamped < 10;

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
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.28, 2.45), woodMat);
      hull.position.y = 0.78;
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.72, 4), woodMat);
      bow.position.set(0, 0.78, -1.58);
      bow.rotation.x = -Math.PI / 2;
      bow.scale.x = 1.08;
      const stern = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.26, 0.34), deckMat);
      stern.position.set(0, 0.8, 1.28);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 2.2), deckMat);
      deck.position.y = 0.98;
      const frontMast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 1.7, 8), deckMat);
      frontMast.position.set(0, 1.74, -0.55);
      const rearMast = frontMast.clone();
      rearMast.position.z = 0.45;
      const sailA = new THREE.Mesh(this.createSailGeometry(0.95, 0.65), new THREE.MeshStandardMaterial({ color: '#fff2d0', roughness: 0.8, side: THREE.DoubleSide }));
      sailA.name = 'custom-sail-front';
      sailA.userData.sailSurface = true;
      sailA.position.set(0, 1.72, -0.55);
      sailA.rotation.y = 0;
      const sailB = sailA.clone();
      sailB.name = 'custom-sail-rear';
      sailB.userData.sailSurface = true;
      sailB.position.z = 0.45;
      kit.add(hull, bow, stern, deck, frontMast, rearMast, sailA, sailB);
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
        const sailC = new THREE.Mesh(this.createSailGeometry(0.8, 0.55), new THREE.MeshStandardMaterial({ color: '#ffe7a8', roughness: 0.8, side: THREE.DoubleSide }));
        sailC.name = 'custom-sail-third';
        sailC.userData.sailSurface = true;
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
      const flagMast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 1.8, 10), steelMat);
      flagMast.position.set(-0.62, 1.92, 0.28);
      const carrierFlag = new THREE.Mesh(
        this.createFlagGeometry(1.5, 0.82),
        new THREE.MeshStandardMaterial({ color: '#fff2d0', roughness: 0.72, side: THREE.DoubleSide }),
      );
      carrierFlag.name = 'carrier-custom-flag';
      carrierFlag.userData.sailSurface = true;
      carrierFlag.position.set(-0.62, 2.28, 0.28);
      kit.add(carrier, bow, runway, island, runwayLine, sternDeck, flagMast, carrierFlag);
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

    const playerCannonBonus = ship === this.player ? Math.floor(this.cannonLevel / 3) : 0;
    const cannonCount = Math.min(5, Math.max(1, Math.ceil(levelClamped / 3) + playerCannonBonus));
    const cannonSize = levelClamped <= 2 ? 0.68 : levelClamped <= 5 ? 0.84 : 1;
    const cannonY = levelClamped >= 10 ? 1.08 : levelClamped >= 6 ? 1.15 : levelClamped >= 3 ? 0.93 : 0.9;
    const cannonZ = levelClamped >= 10 ? -1.15 : levelClamped >= 6 ? -1.18 : levelClamped >= 3 ? -0.88 : -0.62;
    for (let i = 0; i < cannonCount; i += 1) {
      const spread = (i - (cannonCount - 1) / 2) * 0.16 * cannonSize;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.18 * cannonSize, 0.08 * cannonSize, 0.28 * cannonSize), deckMat);
      base.position.set(spread, cannonY - 0.08, cannonZ + 0.08);
      kit.add(base);
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * cannonSize, 0.095 * cannonSize, 0.62 * cannonSize, 12), cannonMat);
      cannon.position.set(spread, cannonY, cannonZ);
      cannon.rotation.x = Math.PI / 2;
      kit.add(cannon);
    }
    ship.add(kit);
    const design = ship.userData.sailDesign as SailDesign | undefined;
    if (design) this.applySailDesign(ship, design);
  }

  private createWorldProps(): THREE.Group {
    const props = new THREE.Group(); const sand = new THREE.MeshStandardMaterial({ color: '#ffd36f', roughness: 0.82 }); const palm = new THREE.MeshStandardMaterial({ color: '#31c85d', roughness: 0.68 }); const trunk = new THREE.MeshStandardMaterial({ color: '#a76027', roughness: 0.72 }); const rockMat = new THREE.MeshStandardMaterial({ color: '#d9e1dc', roughness: 0.88 }); const pierMat = new THREE.MeshStandardMaterial({ color: '#9a5b24', roughness: 0.75 });
    for (const [x, z, s] of [[-23, -14, 1.85], [20, 12, 1.4], [-18, 13, 1.1], [21, -10, 1.0]] as const) {
      const island = new THREE.Group(); const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6 * s, 3.4 * s, 0.45, 18), sand); base.position.y = 0.05; island.add(base);
      const shallows = new THREE.Mesh(
        new THREE.CircleGeometry(4.45 * s, 40),
        new THREE.MeshBasicMaterial({ color: '#8affdf', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
      );
      shallows.rotation.x = -Math.PI / 2;
      shallows.rotation.z = (x - z) * 0.04;
      shallows.scale.set(1.08, 0.86, 1);
      shallows.position.y = -0.008;
      island.add(shallows);
      const shore = new THREE.Mesh(new THREE.RingGeometry(2.72 * s, 3.55 * s, 36), new THREE.MeshBasicMaterial({ color: '#f6ffff', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
      shore.rotation.x = -Math.PI / 2;
      shore.position.y = 0.07;
      island.add(shore);
      for (let w = 0; w < 3; w += 1) {
        const wave = new THREE.Mesh(
          new THREE.RingGeometry((3.05 + w * 0.3) * s, (3.1 + w * 0.3) * s, 40),
          new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.2 - w * 0.045, side: THREE.DoubleSide, depthWrite: false }),
        );
        wave.rotation.x = -Math.PI / 2;
        wave.rotation.z = (x * 0.07 + z * 0.03 + w) % Math.PI;
        wave.scale.setScalar(1 + w * 0.035);
        wave.position.y = 0.095 + w * 0.012;
        island.add(wave);
      }
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

  private updateBossHud(): void {
    const hud = this.getElement('#boss-hud');
    const arrow = this.getElement('#boss-arrow');
    hud.classList.toggle('visible', this.boss !== null);
    if (!this.boss) { arrow.classList.remove('visible'); return; }
    const mainHudBottom = this.getElement('#hud').getBoundingClientRect().bottom;
    hud.style.top = `${Math.ceil(mainHudBottom + 12)}px`;
    this.getElement('#boss-name').textContent = this.boss.name;
    this.getElement('#boss-hp-value').textContent = `${Math.ceil(this.boss.hp)} / ${this.boss.maxHp}`;
    (this.getElement('#boss-hp-fill') as HTMLElement).style.transform = `scaleX(${Math.max(0, this.boss.hp / this.boss.maxHp)})`;
    const projected = this.boss.group.position.clone().project(this.camera);
    const visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 0.92 && Math.abs(projected.y) < 0.86;
    arrow.classList.toggle('visible', !visible);
    if (!visible) {
      const direction = this.boss.group.position.clone().sub(this.player.position).setY(0).normalize();
      const anchorWorld = this.player.position.clone().addScaledVector(direction, this.playerShipRadius() + 2.2).setY(0.85);
      const pointerWorld = anchorWorld.clone().add(direction);
      const anchorScreen = anchorWorld.project(this.camera);
      const pointerScreen = pointerWorld.project(this.camera);
      const left = (anchorScreen.x * 0.5 + 0.5) * window.innerWidth;
      const top = (-anchorScreen.y * 0.5 + 0.5) * window.innerHeight;
      const screenDx = pointerScreen.x - anchorScreen.x;
      const screenDy = -(pointerScreen.y - anchorScreen.y);
      arrow.style.left = `${left}px`;
      arrow.style.top = `${top}px`;
      arrow.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(screenDx, -screenDy)}rad)`;
    }
  }

  private updateGuidance(): void {
    const canBuy = this.coins >= this.minUpgradeCost();
    this.routeLine.visible = true;
    this.islandMarker.visible = true;
    this.routeLine.geometry.setFromPoints([this.player.position.clone().setY(0.12), UPGRADE_ISLAND.clone().setY(0.12)]);
    const routeMaterial = this.routeLine.material;
    if (routeMaterial instanceof THREE.LineBasicMaterial) routeMaterial.opacity = canBuy ? 0.95 : 0.42;
    const player = this.getElement('#map-player'); const island = this.getElement('#map-upgrade'); const line = this.getElement('#map-line');
    const px = ((this.player.position.x / SEA.halfWidth) * 0.5 + 0.5) * 100; const py = ((this.player.position.z / SEA.halfDepth) * 0.5 + 0.5) * 100;
    const ix = ((UPGRADE_ISLAND.x / SEA.halfWidth) * 0.5 + 0.5) * 100; const iy = ((UPGRADE_ISLAND.z / SEA.halfDepth) * 0.5 + 0.5) * 100;
    player.style.left = `${px}%`; player.style.top = `${py}%`; island.style.left = `${ix}%`; island.style.top = `${iy}%`;
    const dx = ix - px; const dy = iy - py; line.style.left = `${px}%`; line.style.top = `${py}%`; line.style.width = `${Math.hypot(dx, dy)}%`; line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`; line.style.display = 'block'; line.style.opacity = canBuy ? '1' : '0.45';
    this.mapEnemies.replaceChildren(...this.enemies.map((enemy) => {
      const dot = document.createElement('i');
      dot.className = 'map-enemy';
      dot.style.left = `${((enemy.group.position.x / SEA.halfWidth) * 0.5 + 0.5) * 100}%`;
      dot.style.top = `${((enemy.group.position.z / SEA.halfDepth) * 0.5 + 0.5) * 100}%`;
      dot.style.transform = `translate(-50%, -50%) scale(${Math.min(1.8, 0.8 + enemy.rank * 0.12)})`;
      return dot;
    }));
    const mapBoss = this.getElement('#map-boss');
    mapBoss.replaceChildren();
    if (this.boss) {
      const dot = document.createElement('i');
      dot.style.left = `${((this.boss.group.position.x / SEA.halfWidth) * 0.5 + 0.5) * 100}%`;
      dot.style.top = `${((this.boss.group.position.z / SEA.halfDepth) * 0.5 + 0.5) * 100}%`;
      mapBoss.append(dot);
    }
    const players = [
      { position: this.player.position, coins: this.coins },
      ...[...this.remotePeers.values()].filter((peer) => peer.group.visible).map((peer) => ({ position: peer.group.position, coins: peer.coins })),
    ];
    const richest = players.sort((a, b) => b.coins - a.coins)[0];
    const richLayer = this.getElement('#map-richest');
    richLayer.replaceChildren();
    if (richest) {
      const dot = document.createElement('i');
      dot.style.left = `${((richest.position.x / SEA.halfWidth) * 0.5 + 0.5) * 100}%`;
      dot.style.top = `${((richest.position.z / SEA.halfDepth) * 0.5 + 0.5) * 100}%`;
      richLayer.append(dot);
    }
    this.updateLeaderboard();
  }

  private updateLeaderboard(): void {
    const rows = [
      { id: this.clientId, name: this.options.playerName, coins: this.coins, hullLevel: this.hullLevel, self: true, ai: false },
      ...[...this.remotePeers.entries()]
        .filter(([, peer]) => peer.group.visible)
        .map(([id, peer]) => ({ id, name: peer.name, coins: peer.coins, hullLevel: peer.hullLevel, self: false, ai: false })),
      ...this.enemies.map((enemy) => ({
        id: `ai-${enemy.group.uuid}`,
        name: enemy.name,
        coins: enemy.coins,
        hullLevel: enemy.rank,
        self: false,
        ai: true,
      })),
    ].sort((a, b) => b.coins - a.coins || b.hullLevel - a.hullLevel || a.name.localeCompare(b.name));
    const topFive = rows.slice(0, 5);
    const selfInTopFive = topFive.some((row) => row.self);
    const displayed = selfInTopFive ? topFive : [...topFive, rows.find((row) => row.self)!];
    this.leaderboard.replaceChildren(...displayed.map((row) => {
      const rank = rows.findIndex((entry) => entry.id === row.id) + 1;
      const item = document.createElement('div');
      item.className = `leaderboard-row${row.self ? ' self' : ''}${row.ai ? ' ai' : ''}${rank > 5 ? ' outside-top' : ''}`;
      const place = document.createElement('span');
      place.className = 'leaderboard-rank';
      place.textContent = `#${rank}`;
      const name = document.createElement('strong');
      name.textContent = row.self ? `${row.name}（你）` : row.ai ? `AI · ${row.name}` : row.name;
      const level = document.createElement('span');
      level.className = 'leaderboard-level';
      level.textContent = `Lv.${row.hullLevel}`;
      const coins = document.createElement('span');
      coins.className = 'leaderboard-coins';
      coins.textContent = String(Math.floor(row.coins));
      item.append(place, name, level, coins);
      return item;
    }));
  }

  private createMinimapIslands(): void {
    this.mapIslands.replaceChildren(...ISLAND_COLLIDERS.map((island, index) => {
      const outline = document.createElement('i');
      outline.className = 'map-island';
      outline.style.left = `${((island.center.x / SEA.halfWidth) * 0.5 + 0.5) * 100}%`;
      outline.style.top = `${((island.center.z / SEA.halfDepth) * 0.5 + 0.5) * 100}%`;
      outline.style.width = `${(island.radius / SEA.halfWidth) * 100}%`;
      outline.style.height = `${(island.radius / SEA.halfDepth) * 100}%`;
      outline.style.setProperty('--island-rotation', `${index * 23 - 18}deg`);
      return outline;
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

  private updateSailorOverlay(): void {
    const overlay = this.getElement('#sailor-overlay');
    overlay.classList.toggle('visible', this.sailorOpen && !this.gameOver);
    const button = this.getElement('#buy-sailor') as HTMLButtonElement;
    const castaway = this.castaways.find((candidate) => !candidate.rescued);
    button.textContent = castaway ? `购买水手（$${castaway.cost}）` : '水手正在赶来';
    button.disabled = !castaway || this.coins < castaway.cost;
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
    if (this.paused || this.gameOver || this.upgradeOpen || this.sailorOpen) {
      this.nameplates.replaceChildren();
      return;
    }
    const entries: Array<{ label: string; position: THREE.Vector3; hp: number; maxHp: number; kind: string }> = [
      { label: `${this.options.playerName} Lv.${this.hullLevel}`, position: this.player.position, hp: this.hp, maxHp: this.maxHp(), kind: 'player' },
      ...[...this.remotePeers.values()].filter((peer) => peer.group.visible).map((peer) => ({ label: `${peer.name} Lv.${peer.hullLevel}`, position: peer.group.position, hp: peer.hp, maxHp: peer.maxHp, kind: 'player' })),
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

  private spawnCoinFlight(position: THREE.Vector3, value: number): void {
    const projected = position.clone().add(new THREE.Vector3(0, 1.25, 0)).project(this.camera);
    const element = document.createElement('div');
    element.className = 'coin-flight';
    element.setAttribute('aria-hidden', 'true');
    element.dataset.value = String(value);
    const coin = document.createElement('i');
    coin.textContent = '$';
    const label = document.createElement('b');
    label.textContent = `+${value}`;
    element.append(coin, label);
    this.floatingTextsLayer.appendChild(element);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startX = THREE.MathUtils.clamp((projected.x * 0.5 + 0.5) * window.innerWidth, 22, window.innerWidth - 22);
    const startY = THREE.MathUtils.clamp((-projected.y * 0.5 + 0.5) * window.innerHeight, 22, window.innerHeight - 22);
    const spreadIndex = (this.coinFlights.length % 5) - 2;
    this.coinFlights.push({
      element,
      value,
      elapsed: 0,
      duration: reducedMotion ? 0.18 : 0.72 + Math.min(4, this.coinFlights.length) * 0.045,
      startX,
      startY,
      spread: spreadIndex * 18,
    });
  }

  private updateCoinFlights(delta: number): void {
    for (let i = this.coinFlights.length - 1; i >= 0; i -= 1) {
      const flight = this.coinFlights[i];
      flight.elapsed += delta;
      const progress = Math.min(1, flight.elapsed / flight.duration);
      const anchor = this.hud.getCoinAnchor();
      let x = flight.startX;
      let y = flight.startY;
      let scale = 0.45;

      if (progress < 0.2) {
        const burst = progress / 0.2;
        const pop = Math.sin(burst * Math.PI);
        x += flight.spread * burst;
        y -= 18 * burst + 28 * pop;
        scale = 0.45 + Math.sin(burst * Math.PI * 0.5) * 0.8;
      } else {
        const raw = (progress - 0.2) / 0.8;
        const eased = raw * raw * (3 - 2 * raw);
        const startX = flight.startX + flight.spread;
        const startY = flight.startY - 18;
        const controlX = (startX + anchor.x) * 0.5 + (flight.spread >= 0 ? 1 : -1) * 74;
        const controlY = Math.min(startY, anchor.y) - Math.min(170, 76 + Math.abs(startY - anchor.y) * 0.24);
        const inverse = 1 - eased;
        x = inverse * inverse * startX + 2 * inverse * eased * controlX + eased * eased * anchor.x;
        y = inverse * inverse * startY + 2 * inverse * eased * controlY + eased * eased * anchor.y;
        scale = THREE.MathUtils.lerp(1.25, 0.42, eased);
      }

      const opacity = progress < 0.08 ? progress / 0.08 : progress > 0.9 ? (1 - progress) / 0.1 : 1;
      flight.element.style.left = `${x}px`;
      flight.element.style.top = `${y}px`;
      flight.element.style.opacity = `${Math.max(0, opacity)}`;
      flight.element.style.transform = `translate(-50%, -50%) scale(${scale}) rotateY(${progress * 900}deg) rotateZ(${progress * 120}deg)`;

      if (progress >= 1) {
        this.coins += flight.value;
        this.hud.flashPickup();
        flight.element.remove();
        this.coinFlights.splice(i, 1);
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
    for (const flight of this.coinFlights) flight.element.remove();
    this.balls.length = 0; this.enemies.length = 0; this.loot.length = 0; this.allies.length = 0; this.castaways.length = 0; this.vfx.length = 0;
    this.floatingTexts.length = 0;
    this.coinFlights.length = 0;
  }

  private clearDynamicExceptEnemies(): void {
    for (const ball of this.balls) this.scene.remove(ball.mesh);
    for (const item of this.loot) this.scene.remove(item.group);
    for (const ally of this.allies) this.scene.remove(ally.group);
    for (const castaway of this.castaways) this.scene.remove(castaway.group);
    for (const effect of this.vfx) this.scene.remove(effect);
    for (const text of this.floatingTexts) text.element.remove();
    for (const flight of this.coinFlights) flight.element.remove();
    this.balls.length = 0;
    this.loot.length = 0;
    this.allies.length = 0;
    this.castaways.length = 0;
    this.vfx.length = 0;
    this.floatingTexts.length = 0;
    this.coinFlights.length = 0;
  }

  private getHudState(): HudState {
    const nearSailor = this.castaways.some((castaway) => !castaway.rescued && castaway.dock.distanceTo(this.player.position) < 4.2);
    return { hp: this.hp, maxHp: this.maxHp(), coins: this.coins, kills: this.kills, wave: this.wave, cannonLevel: this.cannonLevel, hullLevel: this.hullLevel, speedLevel: this.speedLevel, elapsed: this.elapsed, gameOver: this.gameOver, paused: this.paused, cannonCost: this.cannonLevel * 28, hullCost: this.hullLevel * 30, speedCost: this.speedLevel * 24, ammo: this.ammo, maxAmmo: this.maxAmmo, reloading: this.reloading, reloadTimer: this.reloadTimer, nearUpgrade: this.isNearUpgradeDock(), canUpgrade: this.coins >= this.minUpgradeCost(), allies: this.allies.length, nearSailor };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const sailSurfaces: THREE.Object3D[] = [];
    const sailTextures = new Set<THREE.Texture>();
    this.player.traverse((node) => {
      if (node instanceof THREE.Mesh && node.userData.sailSurface === true && node.visible && node.parent?.visible !== false) {
        sailSurfaces.push(node);
        if (node.material instanceof THREE.MeshStandardMaterial && node.material.map) sailTextures.add(node.material.map);
      }
    });
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      wave: this.wave,
      coins: this.coins,
      kills: this.kills,
      gameOver: this.gameOver,
      paused: this.paused,
      entities: {
        enemies: this.enemies.length,
        cannonBalls: this.balls.length,
        crates: this.loot.filter((item) => item.active).length,
        goldCoins: this.loot.filter((item) => item.active && item.kind === 'gold').length,
        goldValues: this.loot.filter((item) => item.active && item.kind === 'gold').map((item) => item.value),
        enemyLevels: this.enemies.map((enemy) => enemy.rank),
        coinFlights: this.coinFlights.length,
        vfx: this.vfx.length,
      },
      audio: this.audio.getDiagnostics(),
      player: {
        hp: this.hp,
        hullLevel: this.hullLevel,
        position: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
        speed: this.playerVelocity.length(),
        sailSurfaces: sailSurfaces.length,
        sailTextures: sailTextures.size,
        carrierFlag: Boolean(this.player.getObjectByName('carrier-custom-flag')),
      },
      camera: {
        distance: this.camera.position.distanceTo(this.player.position),
        fov: this.camera.fov,
        viewScale: this.cameraScaleForLevel(this.hullLevel),
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
