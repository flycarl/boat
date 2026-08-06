/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  wave: number;
  coins: number;
  kills: number;
  gameOver: boolean;
  paused: boolean;
  bankOpen: boolean;
  homeCoins: number;
  cargoCoins: number;
  combo: { count: number; multiplier: number; timer: number };
  wanted: { level: number; bounty: number; timer: number };
  perks: { magnet: number; repair: number; incendiary: number };
  damage: { sail: number; rudder: number; cannon: number };
  seaEvent: { kind: 'gold-rush' | 'storm' | 'convoy'; remaining: number; x: number; z: number } | null;
  mode: { id: 'brawl' | 'treasure' | 'hunt'; objective: string; bossKills: number; goalReached: boolean };
  entities: {
    enemies: number;
    cannonBalls: number;
    crates: number;
    goldCoins: number;
    goldValues: number[];
    enemyLevels: number[];
    coinFlights: number;
    vfx: number;
    splashEvents: number;
  };
  audio: {
    unlocked: boolean;
    contextState: AudioContextState | 'unavailable';
    ambienceActive: boolean;
    sailingLevel: number;
    events: {
      pickup: number;
      cannon: number;
    };
  };
  player: {
    hp: number;
    hullLevel: number;
    position: { x: number; y: number; z: number };
    speed: number;
    sailSurfaces: number;
    sailTextures: number;
    carrierFlag: boolean;
    skinId?: string;
    skinEffectMeshes: number;
  };
  camera: {
    distance: number;
    fov: number;
    viewScale: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __BOAT_DEBUG__?: {
    setHullLevel: (level: number) => void;
    setCoins: (value: number) => void;
    setFirstEnemyLevel: (level: number) => void;
    setFirstEnemyCoins: (value: number) => void;
    sinkFirstEnemy: () => void;
    defeatPlayer: () => void;
    spawnBoss: () => void;
    defeatBoss: () => void;
    collectNearestGold: () => void;
    expireFirstProjectile: () => void;
    hitFirstEnemyWithProjectile: () => void;
    goToBank: () => void;
    goToUpgrade: () => void;
    setCargo: (value: number) => void;
    setWanted: (level: number) => void;
    damagePart: (part: 'sail' | 'rudder' | 'cannon') => void;
    spawnSeaEvent: (kind: 'gold-rush' | 'storm' | 'convoy') => void;
  };
}
