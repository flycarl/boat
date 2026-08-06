type SailingLayer = {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
};

export type AudioDiagnostics = {
  unlocked: boolean;
  contextState: AudioContextState | 'unavailable';
  ambienceActive: boolean;
  sailingLevel: number;
  events: {
    pickup: number;
    cannon: number;
  };
};

export class AudioSystem {
  private context: AudioContext | null = null;
  private unlocked = false;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private wind: SailingLayer | null = null;
  private water: SailingLayer | null = null;
  private sailingLevel = 0;
  private readonly eventCounts = { pickup: 0, cannon: 0 };

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
    this.masterGain = this.context.createGain();
    this.sfxGain = this.context.createGain();
    this.ambienceGain = this.context.createGain();
    this.masterGain.gain.value = 0.86;
    this.sfxGain.gain.value = 0.92;
    this.ambienceGain.gain.value = 1;
    this.sfxGain.connect(this.masterGain);
    this.ambienceGain.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);
    await this.context.resume();
    this.unlocked = true;
    this.startSailingAmbience();
    this.setSailing(this.sailingLevel);
  }

  setSailing(speedRatio: number): void {
    this.sailingLevel = Math.max(0, Math.min(1, speedRatio));
    if (!this.context || !this.wind || !this.water) return;
    const now = this.context.currentTime;
    const moving = this.sailingLevel > 0.035 ? this.sailingLevel : 0;

    this.wind.gain.gain.cancelScheduledValues(now);
    this.wind.gain.gain.setTargetAtTime(moving * 0.041, now, 0.22);
    this.wind.filter.frequency.setTargetAtTime(760 + moving * 1450, now, 0.28);

    this.water.gain.gain.cancelScheduledValues(now);
    this.water.gain.gain.setTargetAtTime(moving * 0.052, now, 0.12);
    this.water.filter.frequency.setTargetAtTime(520 + moving * 820, now, 0.18);
  }

  pickup(seed: number): void {
    if (!this.isRunning()) return;
    this.eventCounts.pickup += 1;
    const variation = (Math.abs(seed) % 7) * 18;
    // Three tiny metal contacts sell the sound of a coin landing and wobbling flat.
    this.coinStrike(1760 + variation, 0.105, 0);
    this.coinStrike(2380 + variation * 1.4, 0.076, 0.052);
    this.coinStrike(2050 - variation * 0.45, 0.048, 0.112);
    this.noise(0.022, 0.065, 3800, 0, 'highpass');
  }

  cannon(): void {
    if (!this.isRunning()) return;
    this.eventCounts.cannon += 1;
    // Fast crack, wooden low-mid punch, and a short sub tail: chunky but arcade-clear.
    this.noise(0.2, 0.075, 2100, 0, 'highpass');
    this.noise(0.32, 0.3, 720, 0.008, 'lowpass');
    this.tone('sawtooth', 92, 39, 0.19, 0.23, 0.005);
    this.tone('triangle', 52, 29, 0.13, 0.32, 0.015);
    this.noise(0.085, 0.19, 460, 0.105, 'lowpass');
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

  getDiagnostics(): AudioDiagnostics {
    return {
      unlocked: this.unlocked,
      contextState: this.context?.state ?? 'unavailable',
      ambienceActive: Boolean(this.wind && this.water),
      sailingLevel: this.sailingLevel,
      events: { ...this.eventCounts },
    };
  }

  dispose(): void {
    this.wind?.source.stop();
    this.water?.source.stop();
    this.wind = null;
    this.water = null;
    void this.context?.close();
    this.context = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.ambienceGain = null;
  }

  private isRunning(): boolean {
    return Boolean(this.context && this.context.state === 'running');
  }

  private output(): AudioNode | null {
    return this.sfxGain ?? this.context?.destination ?? null;
  }

  private coinStrike(frequency: number, volume: number, delay: number): void {
    if (!this.context) return;
    const output = this.output();
    if (!output) return;
    const now = this.context.currentTime + delay;
    const partials = [
      { ratio: 1, gain: 1, duration: 0.19 },
      { ratio: 1.53, gain: 0.38, duration: 0.13 },
      { ratio: 2.72, gain: 0.22, duration: 0.09 },
    ];
    for (const partial of partials) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = partial.ratio === 1 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency * partial.ratio, now);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * partial.ratio * 0.91, now + partial.duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume * partial.gain, now + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + partial.duration);
      oscillator.connect(gain).connect(output);
      oscillator.start(now);
      oscillator.stop(now + partial.duration + 0.02);
    }
  }

  private tone(type: OscillatorType, from: number, to: number, volume: number, duration: number, delay: number): void {
    if (!this.context || !this.isRunning()) return;
    const output = this.output();
    if (!output) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(output);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private noise(volume: number, duration: number, cutoff: number, delay: number, type: BiquadFilterType): void {
    if (!this.context || !this.isRunning()) return;
    const output = this.output();
    if (!output) return;
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
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(output);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  private startSailingAmbience(): void {
    if (!this.context || !this.ambienceGain || this.wind || this.water) return;
    const windSource = this.context.createBufferSource();
    const windFilter = this.context.createBiquadFilter();
    const windGain = this.context.createGain();
    windSource.buffer = this.createLoopingNoise(7, 'wind');
    windSource.loop = true;
    windFilter.type = 'bandpass';
    windFilter.Q.value = 0.55;
    windFilter.frequency.value = 760;
    windGain.gain.value = 0;
    windSource.connect(windFilter).connect(windGain).connect(this.ambienceGain);

    const waterSource = this.context.createBufferSource();
    const waterFilter = this.context.createBiquadFilter();
    const waterGain = this.context.createGain();
    waterSource.buffer = this.createLoopingNoise(5, 'water');
    waterSource.loop = true;
    waterFilter.type = 'lowpass';
    waterFilter.Q.value = 0.8;
    waterFilter.frequency.value = 520;
    waterGain.gain.value = 0;
    waterSource.connect(waterFilter).connect(waterGain).connect(this.ambienceGain);

    windSource.start();
    waterSource.start();
    this.wind = { source: windSource, filter: windFilter, gain: windGain };
    this.water = { source: waterSource, filter: waterFilter, gain: waterGain };
  }

  private createLoopingNoise(duration: number, character: 'wind' | 'water'): AudioBuffer {
    if (!this.context) throw new Error('Audio context is not ready.');
    const sampleCount = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, sampleCount, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let smooth = 0;
    for (let i = 0; i < sampleCount; i += 1) {
      const time = i / this.context.sampleRate;
      const white = Math.random() * 2 - 1;
      smooth = smooth * (character === 'wind' ? 0.985 : 0.94) + white * (character === 'wind' ? 0.015 : 0.06);
      if (character === 'wind') {
        const gust = 0.68 + Math.sin(time * 0.73) * 0.16 + Math.sin(time * 1.91) * 0.1;
        data[i] = (smooth * 3.2 + white * 0.1) * gust;
      } else {
        const chop = 0.42 + Math.pow((Math.sin(time * 7.4) + 1) * 0.5, 4) * 0.72;
        data[i] = (smooth * 2.1 + white * 0.18) * chop;
      }
    }

    const fadeSamples = Math.min(Math.floor(this.context.sampleRate * 0.18), Math.floor(sampleCount / 3));
    for (let i = 0; i < fadeSamples; i += 1) {
      const mix = i / Math.max(1, fadeSamples - 1);
      const tailIndex = sampleCount - fadeSamples + i;
      data[tailIndex] = data[tailIndex] * (1 - mix) + data[i] * mix;
    }
    return buffer;
  }
}
