/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  wave: number;
  coins: number;
  kills: number;
  gameOver: boolean;
  paused: boolean;
  entities: {
    enemies: number;
    cannonBalls: number;
    crates: number;
    goldCoins: number;
    goldValues: number[];
    enemyLevels: number[];
    coinFlights: number;
    vfx: number;
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
    collectNearestGold: () => void;
  };
}
