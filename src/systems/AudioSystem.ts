export class AudioSystem {
  private context: AudioContext | null = null;
  private unlocked = false;

  constructor() {
    const unlock = () => {
      void this.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    await this.context.resume();
    this.unlocked = true;
  }

  pickup(index: number): void {
    if (!this.context || this.context.state !== 'running') return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(320 + index * 22, now);
    oscillator.frequency.exponentialRampToValueAtTime(680 + index * 24, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  }

  cannon(): void {
    this.blip('sawtooth', 90, 38, 0.12, 0.18);
  }

  hit(): void {
    this.blip('square', 130, 70, 0.08, 0.16);
  }

  sink(): void {
    this.blip('triangle', 220, 48, 0.16, 0.35);
  }

  upgrade(): void {
    this.blip('triangle', 420, 880, 0.09, 0.22);
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }

  private blip(type: OscillatorType, from: number, to: number, volume: number, duration: number): void {
    if (!this.context || this.context.state !== 'running') return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
