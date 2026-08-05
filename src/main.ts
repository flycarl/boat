import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const joinPanel = document.querySelector<HTMLFormElement>('#join-panel');
const nameInput = document.querySelector<HTMLInputElement>('#player-name-input');
const roomInput = document.querySelector<HTMLInputElement>('#room-code-input');

if (!canvas) {
  throw new Error('Missing #game-canvas element.');
}

let game: Game | null = null;

const savedName = localStorage.getItem('boat.playerName') ?? '';
const savedRoom = localStorage.getItem('boat.roomCode') ?? '';
if (nameInput) nameInput.value = savedName;
if (roomInput) roomInput.value = savedRoom;

joinPanel?.addEventListener('submit', (event) => {
  event.preventDefault();
  const playerName = (nameInput?.value.trim() || 'Captain').slice(0, 14);
  const roomCode = (roomInput?.value.replace(/\D/g, '').slice(0, 4) || '0000').padStart(4, '0');
  if (roomInput) roomInput.value = roomCode;
  localStorage.setItem('boat.playerName', playerName);
  localStorage.setItem('boat.roomCode', roomCode);
  joinPanel.classList.add('hidden');
  game = new Game(canvas, { playerName, roomCode });
  game.start();
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
  });
}
