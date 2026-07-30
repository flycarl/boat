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
    vfx: number;
  };
  player: {
    hp: number;
    position: { x: number; y: number; z: number };
    speed: number;
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
}
