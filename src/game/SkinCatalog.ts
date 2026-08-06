export type SkinRole = 'hull' | 'deck' | 'accent' | 'metal';

export type ShipSkin = {
  id: string;
  level: number;
  name: string;
  collection: string;
  price: number;
  colors: Record<SkinRole, string>;
  effect: {
    kind: 'sunwake' | 'abyss' | 'tideguard';
    glow: string;
    secondaryGlow: string;
    trail: string;
  };
  sail: {
    primaryPattern: 'anchor' | 'skull' | 'sun' | 'compass';
    secondaryPattern: 'waves' | 'stripes' | 'diamonds' | 'stars';
    primaryColor: string;
    secondaryColor: string;
  };
};

const LEVEL_NAMES = [
  '漂流木筏', '双桨猎舟', '珊瑚快艇', '破浪轻帆', '赤湾巡舰', '远洋战船',
  '王冠护卫舰', '暴风巡洋舰', '海皇旗舰', '钢铁航母', '苍穹航母', '无畏母舰',
];

const WARM_HULLS = ['#8b3f2c', '#99472d', '#a44b2e', '#aa3f33', '#b04434', '#9f3b32', '#a94734', '#8f322f', '#79302f', '#6f3632', '#60393a', '#4b3437'];
const ABYSS_HULLS = ['#183c55', '#173d5f', '#17476b', '#164f73', '#1a4773', '#283d71', '#313871', '#37336d', '#34365f', '#303f55', '#2b4655', '#243e4a'];
const TIDE_HULLS = ['#246552', '#1f6d5a', '#187463', '#167d70', '#21806d', '#2a7860', '#337357', '#28725e', '#23685d', '#28625d', '#2a5956', '#274d4d'];

const buildSkin = (level: number, variant: number): ShipSkin => {
  const levelName = LEVEL_NAMES[level - 1];
  const price = 7 + Math.ceil((level - 1) * 0.9) + variant * 2;
  if (variant === 0) {
    return {
      id: `level-${level}-sunwake`, level, name: `${levelName} · 曜金`, collection: '曙光舰队', price,
      colors: { hull: WARM_HULLS[level - 1], deck: '#4a271c', accent: '#ffd66b', metal: '#3a302b' },
      effect: { kind: 'sunwake', glow: '#ffd84f', secondaryGlow: '#ff5a36', trail: '#ffb52e' },
      sail: { primaryPattern: 'sun', secondaryPattern: 'stripes', primaryColor: '#d94832', secondaryColor: '#e9a62d' },
    };
  }
  if (variant === 1) {
    return {
      id: `level-${level}-abyss`, level, name: `${levelName} · 星渊`, collection: '深海舰队', price,
      colors: { hull: ABYSS_HULLS[level - 1], deck: '#101d2b', accent: '#65e6f3', metal: '#728797' },
      effect: { kind: 'abyss', glow: '#63efff', secondaryGlow: '#d652ff', trail: '#5edfff' },
      sail: { primaryPattern: 'compass', secondaryPattern: 'stars', primaryColor: '#71edff', secondaryColor: '#31529a' },
    };
  }
  return {
    id: `level-${level}-tideguard`, level, name: `${levelName} · 翠潮`, collection: '翡翠舰队', price,
    colors: { hull: TIDE_HULLS[level - 1], deck: '#49372b', accent: '#f0c36a', metal: '#40565a' },
    effect: { kind: 'tideguard', glow: '#58ffc7', secondaryGlow: '#ffd45e', trail: '#54eebc' },
    sail: { primaryPattern: 'anchor', secondaryPattern: 'diamonds', primaryColor: '#0f765f', secondaryColor: '#e4b758' },
  };
};

export const SHIP_SKINS: ShipSkin[] = Array.from({ length: 12 }, (_, index) => index + 1)
  .flatMap((level) => [0, 1, 2].map((variant) => buildSkin(level, variant)));

export const skinsForLevel = (level: number): ShipSkin[] => SHIP_SKINS.filter((skin) => skin.level === level);

export const findShipSkin = (id: string | undefined): ShipSkin | undefined => SHIP_SKINS.find((skin) => skin.id === id);
