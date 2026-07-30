export type HudState = {
  hp: number;
  maxHp: number;
  coins: number;
  kills: number;
  wave: number;
  cannonLevel: number;
  hullLevel: number;
  speedLevel: number;
  elapsed: number;
  gameOver: boolean;
  paused: boolean;
  cannonCost: number;
  hullCost: number;
  speedCost: number;
  ammo: number;
  maxAmmo: number;
  reloading: boolean;
  reloadTimer: number;
  nearUpgrade: boolean;
  canUpgrade: boolean;
  allies: number;
};

export class Hud {
  private readonly hpFill = this.getElement('#hp-fill');
  private readonly hpValue = this.getElement('#hp-value');
  private readonly coinValue = this.getElement('#coin-value');
  private readonly ammoValue = this.getElement('#ammo-value');
  private readonly killValue = this.getElement('#kill-value');
  private readonly waveValue = this.getElement('#wave-value');
  private readonly levelValue = this.getElement('#level-value');
  private readonly timerValue = this.getElement('#timer-value');
  private readonly statusLine = this.getElement('#status-line');
  private readonly upgradeLine = this.getElement('#upgrade-line');
  private readonly overlay = this.getElement('#overlay');

  update(state: HudState): void {
    const hpRatio = Math.max(0, state.hp / state.maxHp);
    this.hpFill.style.transform = `scaleX(${hpRatio})`;
    this.hpValue.textContent = `${Math.max(0, Math.ceil(state.hp))}/${state.maxHp}`;
    this.coinValue.textContent = String(state.coins);
    this.ammoValue.textContent = state.reloading ? `装弹 ${state.reloadTimer.toFixed(1)}` : `${state.ammo}/${state.maxAmmo}`;
    this.killValue.textContent = `${state.kills}+${state.allies}`;
    this.waveValue.textContent = String(state.wave);
    this.levelValue.textContent = String(state.hullLevel);
    const minutes = Math.floor(state.elapsed / 60).toString().padStart(2, '0');
    const seconds = Math.floor(state.elapsed % 60).toString().padStart(2, '0');
    this.timerValue.textContent = `${minutes}:${seconds}`;
    this.statusLine.textContent = state.gameOver
      ? '船沉了：点击重新开始'
      : state.paused
        ? '已暂停：ESC 继续，可更改旗帜'
        : state.nearUpgrade
          ? '已到升级岛：按 1/2/3 购买升级'
          : state.canUpgrade
            ? '金币够了：跟着绿色航线进金色港口'
            : '鼠标转向，左键开炮，右键换弹';
    this.upgradeLine.textContent = `升级岛购买：1 火炮 Lv.${state.cannonLevel} $${state.cannonCost} · 2 船体 Lv.${state.hullLevel} $${state.hullCost} · 3 航速 Lv.${state.speedLevel} $${state.speedCost}`;
    this.overlay.classList.toggle('visible', state.gameOver || state.paused);
    this.overlay.classList.toggle('gameover', state.gameOver);
    if (state.gameOver) this.overlay.querySelector('h1')!.textContent = '你被击沉了';
    else this.overlay.querySelector('h1')!.textContent = '暂停';
    const p = this.overlay.querySelector('p');
    if (p) p.textContent = state.gameOver ? 'Backspace 重新开始 · ESC 返回菜单' : 'ESC 继续 · Backspace 重新开始 · 右键换弹';
  }

  flashPickup(): void {
    this.statusLine.animate(
      [
        { transform: 'translateY(0)', borderLeftColor: '#f8d66d' },
        { transform: 'translateY(-3px)', borderLeftColor: '#40e0c0' },
        { transform: 'translateY(0)', borderLeftColor: '#f8d66d' },
      ],
      { duration: 240, easing: 'ease-out' },
    );
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
