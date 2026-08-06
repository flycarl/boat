import { findShipSkin } from '../game/SkinCatalog';

const PROFILE_KEY = 'boat.profile.v1';

export type BoatProfile = {
  homeCoins: number;
  ownedSkinIds: string[];
  equippedSkins: Record<number, string>;
};

const DEFAULT_PROFILE: BoatProfile = { homeCoins: 0, ownedSkinIds: [], equippedSkins: {} };

export const loadProfile = (): BoatProfile => {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Partial<BoatProfile> | null;
    if (!saved) return structuredClone(DEFAULT_PROFILE);
    const ownedSkinIds = Array.isArray(saved.ownedSkinIds)
      ? saved.ownedSkinIds.filter((id): id is string => typeof id === 'string' && Boolean(findShipSkin(id)))
      : [];
    const equippedSkins: Record<number, string> = {};
    for (const [levelRaw, id] of Object.entries(saved.equippedSkins ?? {})) {
      const level = Number(levelRaw);
      const skin = typeof id === 'string' ? findShipSkin(id) : undefined;
      if (skin && skin.level === level && ownedSkinIds.includes(id as string)) equippedSkins[level] = id as string;
    }
    return {
      homeCoins: Math.max(0, Math.floor(Number(saved.homeCoins) || 0)),
      ownedSkinIds,
      equippedSkins,
    };
  } catch {
    return structuredClone(DEFAULT_PROFILE);
  }
};

export const saveProfile = (profile: BoatProfile): void => {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
};

export const depositHomeCoins = (profile: BoatProfile, amount: number): number => {
  profile.homeCoins += Math.max(0, Math.floor(amount));
  saveProfile(profile);
  return profile.homeCoins;
};

export const buyOrEquipSkin = (profile: BoatProfile, skinId: string): 'bought' | 'equipped' | 'insufficient' | 'missing' => {
  const skin = findShipSkin(skinId);
  if (!skin) return 'missing';
  const alreadyOwned = profile.ownedSkinIds.includes(skin.id);
  if (!alreadyOwned) {
    if (profile.homeCoins < skin.price) return 'insufficient';
    profile.homeCoins -= skin.price;
    profile.ownedSkinIds.push(skin.id);
  }
  profile.equippedSkins[skin.level] = skin.id;
  saveProfile(profile);
  return alreadyOwned ? 'equipped' : 'bought';
};
