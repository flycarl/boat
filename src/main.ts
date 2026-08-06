import './styles.css';
import { Game } from './game/Game';
import { GAME_MODES, isGameMode, type GameMode } from './game/GameMode';
import { skinsForLevel } from './game/SkinCatalog';
import { buyOrEquipSkin, depositHomeCoins, loadProfile } from './profile/ProfileStore';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const joinPanel = document.querySelector<HTMLFormElement>('#join-panel');
const nameInput = document.querySelector<HTMLInputElement>('#player-name-input');
const roomInput = document.querySelector<HTMLInputElement>('#room-code-input');
const skinShop = document.querySelector<HTMLElement>('#skin-shop-overlay');
const skinGrid = document.querySelector<HTMLElement>('#skin-grid');
const skinTabs = document.querySelector<HTMLElement>('#skin-level-tabs');
const homeCoinValue = document.querySelector<HTMLElement>('#home-coin-value');
const shopCoinValue = document.querySelector<HTMLElement>('#shop-coin-value');
const joinButton = document.querySelector<HTMLButtonElement>('#join-button');
const modeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="gameMode"]')];

if (!canvas) {
  throw new Error('Missing #game-canvas element.');
}

let game: Game | null = null;
const profile = loadProfile();
let selectedSkinLevel = 1;

const updateWallets = (): void => {
  if (homeCoinValue) homeCoinValue.textContent = String(profile.homeCoins);
  if (shopCoinValue) shopCoinValue.textContent = String(profile.homeCoins);
};

const renderSkinShop = (): void => {
  updateWallets();
  skinTabs?.replaceChildren(...Array.from({ length: 12 }, (_, index) => {
    const level = index + 1;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Lv.${level}`;
    button.className = level === selectedSkinLevel ? 'selected' : '';
    button.addEventListener('click', () => { selectedSkinLevel = level; renderSkinShop(); });
    return button;
  }));
  skinGrid?.replaceChildren(...skinsForLevel(selectedSkinLevel).map((skin) => {
    const owned = profile.ownedSkinIds.includes(skin.id);
    const equipped = profile.equippedSkins[skin.level] === skin.id;
    const card = document.createElement('article');
    card.className = `skin-card skin-${skin.effect.kind}${equipped ? ' equipped' : ''}`;
    card.style.setProperty('--skin-hull', skin.colors.hull);
    card.style.setProperty('--skin-deck', skin.colors.deck);
    card.style.setProperty('--skin-accent', skin.colors.accent);
    card.style.setProperty('--skin-sail-a', skin.sail.primaryColor);
    card.style.setProperty('--skin-sail-b', skin.sail.secondaryColor);
    card.style.setProperty('--skin-glow', skin.effect.glow);
    card.style.setProperty('--skin-glow-2', skin.effect.secondaryGlow);
    card.innerHTML = `
      <div class="skin-boat-preview" aria-hidden="true"><i class="skin-sail"></i><i class="skin-mast"></i><i class="skin-hull"></i><i class="skin-water"></i></div>
      <span class="skin-collection">${skin.collection}</span>
      <h2>${skin.name}</h2>
      <div class="skin-swatches"><i></i><i></i><i></i><i></i></div>
      <button type="button" ${equipped ? 'disabled' : ''}>${equipped ? '已装备' : owned ? '装备' : `◆ ${skin.price} 购买`}</button>`;
    card.querySelector('button')?.addEventListener('click', () => {
      const result = buyOrEquipSkin(profile, skin.id);
      if (result === 'insufficient') {
        card.classList.add('insufficient');
        window.setTimeout(() => card.classList.remove('insufficient'), 500);
        return;
      }
      renderSkinShop();
    });
    return card;
  }));
};

document.querySelector('#open-skin-shop')?.addEventListener('click', () => {
  renderSkinShop();
  skinShop?.classList.add('visible');
  skinShop?.setAttribute('aria-hidden', 'false');
});

document.querySelector('#close-skin-shop')?.addEventListener('click', () => {
  skinShop?.classList.remove('visible');
  skinShop?.setAttribute('aria-hidden', 'true');
});

updateWallets();

const savedName = localStorage.getItem('boat.playerName') ?? '';
const savedRoom = localStorage.getItem('boat.roomCode') ?? '';
const savedModeValue = localStorage.getItem('boat.gameMode');
let selectedMode: GameMode = isGameMode(savedModeValue) ? savedModeValue : 'brawl';
if (nameInput) nameInput.value = savedName;
if (roomInput) roomInput.value = savedRoom;

const updateModeSelection = (): void => {
  for (const input of modeInputs) input.checked = input.value === selectedMode;
  if (joinButton) joinButton.textContent = `进入${GAME_MODES[selectedMode].name}`;
};

for (const input of modeInputs) {
  input.addEventListener('change', () => {
    if (!input.checked || !isGameMode(input.value)) return;
    selectedMode = input.value;
    localStorage.setItem('boat.gameMode', selectedMode);
    updateModeSelection();
  });
}
updateModeSelection();

joinPanel?.addEventListener('submit', (event) => {
  event.preventDefault();
  const playerName = (nameInput?.value.trim() || 'Captain').slice(0, 14);
  const roomCode = (roomInput?.value.replace(/\D/g, '').slice(0, 4) || '0000').padStart(4, '0');
  if (roomInput) roomInput.value = roomCode;
  localStorage.setItem('boat.playerName', playerName);
  localStorage.setItem('boat.roomCode', roomCode);
  localStorage.setItem('boat.gameMode', selectedMode);
  joinPanel.classList.add('hidden');
  game = new Game(canvas, {
    playerName,
    roomCode,
    mode: selectedMode,
    homeCoins: profile.homeCoins,
    equippedSkins: { ...profile.equippedSkins },
    onBankExchange: (amount) => {
      const balance = depositHomeCoins(profile, amount);
      updateWallets();
      return balance;
    },
  });
  game.start();
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
  });
}
