export class AudioSystem {
  private context: AudioContext | null = null;
  private unlocked = false;
  private ambient: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

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
    this.startAmbience();
  }

  pickup(index: number): void {
    if (!this.context || this.context.state !== 'running') return;
    this.tone('triangle', 620 + index * 4, 980 + index * 4, 0.052, 0.1, 0);
    this.tone('sine', 980 + index * 3, 1460 + index * 3, 0.045, 0.13, 0.055);
    this.tone('triangle', 1460, 1880, 0.028, 0.16, 0.12);
    this.noise(0.025, 0.08, 3200, 0.01, 'highpass');
  }

  cannon(): void {
    if (!this.context || this.context.state !== 'running') return;
    this.noise(0.16, 0.18, 450, 0.035, 'lowpass');
    this.tone('sawtooth', 84, 38, 0.13, 0.19, 0);
    this.tone('triangle', 48, 32, 0.08, 0.22, 0.012);
  }

  hit(): void {
    this.noise(0.09, 0.11, 900, 0.01, 'bandpass');
    this.tone('square', 140, 75, 0.055, 0.11, 0);
  }

  sink(): void {
    this.noise(0.2, 0.42, 520, 0.02, 'lowpass');
    this.tone('triangle', 180, 42, 0.12, 0.42, 0);
  }

  upgrade(): void {
    this.tone('triangle', 380, 760, 0.055, 0.12, 0);
    this.tone('sine', 760, 1280, 0.05, 0.16, 0.075);
  }

  dispose(): void {
    this.ambient?.source.stop();
    this.ambient = null;
    void this.context?.close();
    this.context = null;
  }

  private tone(type: OscillatorType, from: number, to: number, volume: number, duration: number, delay: number): void {
    if (!this.context || this.context.state !== 'running') return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private noise(volume: number, duration: number, cutoff: number, delay: number, type: BiquadFilterType): void {
    if (!this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime + delay;
    const samples = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, samples, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / samples);
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = type;
    filter.frequency.setValueAtTime(cutoff, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.context.destination);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  private startAmbience(): void {
    if (!this.context || this.ambient) return;
    const duration = 2.5;
    const samples = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, samples, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i += 1) {
      const slowWave = Math.sin((i / samples) * Math.PI * 8) * 0.35;
      data[i] = (Math.random() * 2 - 1) * 0.12 + slowWave * 0.06;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    gain.gain.value = 0.018;
    source.connect(filter).connect(gain).connect(this.context.destination);
    source.start();
    this.ambient = { source, gain };
  }
}
