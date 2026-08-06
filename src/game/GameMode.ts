export type GameMode = 'brawl' | 'treasure' | 'hunt';

export type GameModeRules = {
  id: GameMode;
  name: string;
  shortName: string;
  description: string;
  objective: string;
  startingEnemies: number;
  bossDelay: number;
  bossRespawnDelay: number;
  eventDelay: number;
  startingGold: number;
  goldMultiplier: number;
};

export const GAME_MODES: Record<GameMode, GameModeRules> = {
  brawl: {
    id: 'brawl',
    name: '自由乱斗',
    shortName: '乱斗',
    description: '玩家与海盗混战，通缉、海怪和随机事件全部开启。',
    objective: '击沉敌船，抢走货舱并成为金币榜首',
    startingEnemies: 7,
    bossDelay: 45,
    bossRespawnDelay: 75,
    eventDelay: 14,
    startingGold: 0,
    goldMultiplier: 1,
  },
  treasure: {
    id: 'treasure',
    name: '淘金撤离',
    shortName: '淘金',
    description: '黄金潮更频繁，金币价值更高；把 500 金币安全送回银行。',
    objective: '安全入库 500 金币',
    startingEnemies: 5,
    bossDelay: 105,
    bossRespawnDelay: 90,
    eventDelay: 4,
    startingGold: 9,
    goldMultiplier: 1.5,
  },
  hunt: {
    id: 'hunt',
    name: '巨兽狩猎',
    shortName: '狩猎',
    description: '海怪会快速出现并不断回归；与同房船长合作击败三只巨兽。',
    objective: '全队击败 3 只深海巨兽',
    startingEnemies: 4,
    bossDelay: 4,
    bossRespawnDelay: 18,
    eventDelay: 60,
    startingGold: 3,
    goldMultiplier: 1,
  },
};

export const isGameMode = (value: string | null | undefined): value is GameMode =>
  value === 'brawl' || value === 'treasure' || value === 'hunt';

