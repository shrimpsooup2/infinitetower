// Synthesized sound effects (WebAudio, no files). Each preset is a tiny
// recipe of oscillators / noise with envelopes. Voices are rate-limited so
// big fights stay readable.

import type { SoundPreset } from '../effects/types.ts';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  private active = 0;
  volume = 0.6;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.enabled = false;
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.master!.gain.value = this.volume * 0.5;
    return this.ctx;
  }

  /** Call from a user gesture so browsers allow audio. */
  unlock(): void {
    this.ensure();
  }

  play(preset: SoundPreset | 'ui' | 'place' | 'upgrade' | 'fanfare' | 'wave' | 'error', pitch = 1, vol = 1): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const key = preset;
    const minGap = preset === 'boom' ? 0.08 : 0.035;
    if ((this.last.get(key) ?? -1) > now - minGap || this.active > 22) return;
    this.last.set(key, now);
    const out = ctx.createGain();
    out.connect(this.master);
    this.active++;
    const done = (t: number) => setTimeout(() => { this.active--; out.disconnect(); }, t * 1000 + 50);
    const env = (g: GainNode, peak: number, a: number, d: number) => {
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * vol), now + a);
      g.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
    };
    const osc = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0 * pitch, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pitch), now + dur);
      env(g, peak, 0.005, dur);
      o.connect(g).connect(out);
      o.start(now);
      o.stop(now + dur + 0.05);
    };
    const noise = (type: BiquadFilterType, f0: number, f1: number, dur: number, peak: number, q = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.Q.value = q;
      f.frequency.setValueAtTime(f0 * pitch, now);
      f.frequency.exponentialRampToValueAtTime(Math.max(30, f1 * pitch), now + dur);
      const g = ctx.createGain();
      env(g, peak, 0.004, dur);
      s.connect(f).connect(g).connect(out);
      s.start(now);
      s.stop(now + dur + 0.05);
    };
    let dur = 0.15;
    switch (preset) {
      case 'pew': osc('square', 880, 320, 0.07, 0.12); dur = 0.08; break;
      case 'zap': osc('sawtooth', 1400, 180, 0.1, 0.1); noise('highpass', 3000, 1500, 0.08, 0.08); dur = 0.12; break;
      case 'boom': noise('lowpass', 900, 80, 0.35, 0.45); osc('sine', 120, 40, 0.3, 0.3); dur = 0.4; break;
      case 'chime': osc('sine', 1320, 1320, 0.4, 0.12); osc('sine', 1980, 1980, 0.3, 0.06); dur = 0.45; break;
      case 'thud': osc('sine', 190, 55, 0.16, 0.35); dur = 0.18; break;
      case 'hiss': noise('bandpass', 3200, 2400, 0.12, 0.12, 0.8); dur = 0.14; break;
      case 'warble': {
        const o = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        const g = ctx.createGain();
        o.frequency.value = 420 * pitch;
        lfo.frequency.value = 18;
        lg.gain.value = 60;
        lfo.connect(lg).connect(o.frequency);
        env(g, 0.14, 0.01, 0.28);
        o.connect(g).connect(out);
        o.start(now);
        lfo.start(now);
        o.stop(now + 0.32);
        lfo.stop(now + 0.32);
        dur = 0.33;
        break;
      }
      case 'pluck': osc('triangle', 660, 640, 0.14, 0.18); dur = 0.15; break;
      case 'laser': osc('square', 1500, 900, 0.12, 0.05); dur = 0.13; break;
      case 'whoosh': noise('bandpass', 400, 2200, 0.22, 0.14, 1.2); dur = 0.24; break;
      case 'ui': osc('triangle', 900, 900, 0.05, 0.1); dur = 0.06; break;
      case 'place': osc('sine', 330, 220, 0.12, 0.28); noise('lowpass', 800, 200, 0.08, 0.1); dur = 0.14; break;
      case 'upgrade': osc('triangle', 520, 1040, 0.2, 0.16); osc('sine', 780, 1560, 0.25, 0.08); dur = 0.26; break;
      case 'wave': osc('sawtooth', 220, 330, 0.3, 0.08); osc('square', 110, 165, 0.3, 0.05); dur = 0.32; break;
      case 'error': osc('square', 180, 140, 0.12, 0.08); dur = 0.13; break;
      case 'fanfare': {
        [523, 659, 784, 1047].forEach((f, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'triangle';
          o.frequency.value = f;
          const t = now + i * 0.11;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.18 * vol, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
          o.connect(g).connect(out);
          o.start(t);
          o.stop(t + 0.55);
        });
        dur = 1;
        break;
      }
    }
    done(dur);
  }
}
