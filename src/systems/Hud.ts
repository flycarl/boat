export type HudState = {
  modeName: string;
  modeObjective: string;
  modeGoalReached: boolean;
  hp: number;
  maxHp: number;
  coins: number;
  cargoCoins: number;
  comboCount: number;
  comboMultiplier: number;
  comboTimer: number;
  wantedLevel: number;
  wantedBounty: number;
  damagedPart: string;
  seaEventTitle: string;
  seaEventDetail: string;
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
  nearSailor: boolean;
  nearBank: boolean;
  homeCoins: number;
  allies: number;
};

export class Hud {
  private readonly modeName = this.getElement('#game-mode-name');
  private readonly modeObjective = this.getElement('#mode-objective');
  private readonly hpFill = this.getElement('#hp-fill');
  private readonly hpValue = this.getElement('#hp-value');
  private readonly coinValue = this.getElement('#coin-value');
  private readonly cargoValue = this.getElement('#cargo-value');
  private readonly comboBadge = this.getElement('#combo-badge');
  private readonly comboValue = this.getElement('#combo-value');
  private readonly wantedBadge = this.getElement('#wanted-badge');
  private readonly wantedValue = this.getElement('#wanted-value');
  private readonly partDamage = this.getElement('#part-damage');
  private readonly partDamageValue = this.getElement('#part-damage-value');
  private readonly seaEventBanner = this.getElement('#sea-event-banner');
  private readonly seaEventKind = this.getElement('#sea-event-kind');
  private readonly seaEventValue = this.getElement('#sea-event-value');
  private readonly ammoValue = this.getElement('#ammo-value');
  private readonly killValue = this.getElement('#kill-value');
  private readonly waveValue = this.getElement('#wave-value');
  private readonly levelValue = this.getElement('#level-value');
  private readonly timerValue = this.getElement('#timer-value');
  private readonly statusLine = this.getElement('#status-line');
  private readonly upgradeLine = this.getElement('#upgrade-line');
  private readonly overlay = this.getElement('#overlay');

  update(state: HudState): void {
    this.modeName.textContent = state.modeName;
    this.modeObjective.textContent = state.modeObjective;
    this.modeObjective.classList.toggle('complete', state.modeGoalReached);
    const hpRatio = Math.max(0, state.hp / state.maxHp);
    this.hpFill.style.transform = `scaleX(${hpRatio})`;
    this.hpValue.textContent = `${Math.max(0, Math.ceil(state.hp))}/${state.maxHp}`;
    this.coinValue.textContent = String(state.coins);
    this.cargoValue.textContent = String(state.cargoCoins);
    this.comboValue.textContent = state.comboCount > 1 ? `x${state.comboMultiplier} · ${state.comboCount}` : 'x1';
    this.comboBadge.classList.toggle('active', state.comboCount > 1 && state.comboTimer > 0);
    this.wantedValue.textContent = state.wantedLevel > 0 ? `★${state.wantedLevel} · $${state.wantedBounty}` : '安全';
    this.wantedBadge.classList.toggle('active', state.wantedLevel > 0);
    this.partDamageValue.textContent = state.damagedPart;
    this.partDamage.classList.toggle('damaged', state.damagedPart !== '正常');
    this.seaEventKind.textContent = state.seaEventTitle;
    this.seaEventValue.textContent = state.seaEventDetail;
    this.seaEventBanner.classList.toggle('active', state.seaEventTitle !== '海域平静');
    this.ammoValue.textContent = state.reloading ? `装弹 ${state.reloadTimer.toFixed(1)}` : `${state.ammo}/${state.maxAmmo}`;
    this.killValue.textContent = `${state.kills}+${state.allies}`;
    this.waveValue.textContent = String(state.wave);
    this.levelValue.textContent = String(state.hullLevel);
    const safeElapsed = Number.isFinite(state.elapsed) ? Math.max(0, state.elapsed) : 0;
    const minutes = Math.floor(safeElapsed / 60).toString().padStart(2, '0');
    const seconds = Math.floor(safeElapsed % 60).toString().padStart(2, '0');
    this.timerValue.textContent = `${minutes}:${seconds}`;
    this.statusLine.textContent = state.gameOver
      ? '船沉了：点击重新开始'
      : state.paused
        ? '个人观战：你已隐藏，可组合船帆图案'
        : state.nearUpgrade
          ? '已到港口：可以直接升级'
          : state.nearBank
            ? `潮汐银行：船舱自动入库 · 25 已存金币兑换 1 首页金币 · 金库 ${state.homeCoins}`
          : state.nearSailor
            ? '水手营地：进凹槽后可花 200 金币雇佣'
          : state.cargoCoins > 0
            ? `船舱装有 ${state.cargoCoins} 金币：沿蓝色航线回银行入库`
          : state.canUpgrade
            ? '已存金币够了：跟着绿色航线进金色港口'
            : '鼠标转向，左键开炮，右键换弹';
    this.upgradeLine.textContent = `港口三选一：火炮 Lv.${state.cannonLevel} · 船体 Lv.${state.hullLevel} · 航速 Lv.${state.speedLevel} · 另有磁索 / 修补 / 燃烧`;
    this.overlay.classList.toggle('visible', state.gameOver || state.paused);
    this.overlay.classList.toggle('gameover', state.gameOver);
    if (state.gameOver) this.overlay.querySelector('h1')!.textContent = '你被击沉了';
    else this.overlay.querySelector('h1')!.textContent = '暂停';
    const p = this.overlay.querySelector('p');
    if (p) p.textContent = state.gameOver ? '只能重新开始 · ESC 返回菜单' : '个人观战模式 · 其他玩家会继续战斗 · ESC 继续';
    const resume = this.overlay.querySelector<HTMLElement>('#resume-button');
    if (resume) resume.style.display = state.gameOver ? 'none' : 'inline-block';
  }

  getCoinAnchor(): { x: number; y: number } {
    const rect = this.cargoValue.getBoundingClientRect();
    return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
  }

  flashPickup(): void {
    this.cargoValue.animate(
      [
        { transform: 'scale(1)', color: '#fff4d6', textShadow: '0 0 0 rgba(255, 222, 80, 0)' },
        { transform: 'scale(1.42)', color: '#fff38a', textShadow: '0 0 18px rgba(255, 201, 45, 0.95)' },
        { transform: 'scale(1)', color: '#fff4d6', textShadow: '0 0 0 rgba(255, 222, 80, 0)' },
      ],
      { duration: 280, easing: 'cubic-bezier(.18,.8,.28,1)' },
    );
    this.cargoValue.parentElement?.animate(
      [
        { filter: 'brightness(1)', borderColor: 'rgba(255, 244, 214, 0.25)' },
        { filter: 'brightness(1.6)', borderColor: '#f8d66d' },
        { filter: 'brightness(1)', borderColor: 'rgba(255, 244, 214, 0.25)' },
      ],
      { duration: 320, easing: 'ease-out' },
    );
  }

  flashBank(): void {
    this.coinValue.parentElement?.animate(
      [
        { transform: 'translateY(0) scale(1)', filter: 'brightness(1)' },
        { transform: 'translateY(-3px) scale(1.08)', filter: 'brightness(1.75)' },
        { transform: 'translateY(0) scale(1)', filter: 'brightness(1)' },
      ],
      { duration: 440, easing: 'cubic-bezier(.18,.8,.28,1)' },
    );
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
