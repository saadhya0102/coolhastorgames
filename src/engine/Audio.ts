/** Tiny WebAudio synth for sound effects + simple music.
 * No asset files needed - everything is generated procedurally so games stay
 * lightweight and load instantly. Respects a global mute flag in localStorage. */
const MUTE_KEY = "chg.muted";

type Wave = OscillatorType;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private _muted = false;

  constructor() {
    this._muted = localStorage.getItem(MUTE_KEY) === "1";
  }

  private ensure(): AudioContext | null {
    if (this._muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.25;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  get muted() {
    return this._muted;
  }

  setMuted(m: boolean) {
    this._muted = m;
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  }

  /** Play a single tone. */
  tone(freq: number, dur = 0.12, type: Wave = "square", vol = 0.5) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Frequency sweep (whoosh / jump). */
  sweep(from: number, to: number, dur = 0.2, type: Wave = "sine", vol = 0.4) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Noise burst (explosion / hit). */
  noise(dur = 0.2, vol = 0.4) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(this.master);
    src.start();
  }

  // Convenience sfx
  blip() {
    this.tone(660, 0.06, "square", 0.3);
  }
  coin() {
    this.tone(880, 0.06, "square", 0.4);
    setTimeout(() => this.tone(1320, 0.08, "square", 0.4), 60);
  }
  jump() {
    this.sweep(300, 720, 0.18, "sine", 0.4);
  }
  hit() {
    this.noise(0.18, 0.5);
  }
  explosion() {
    this.noise(0.5, 0.6);
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.14, "triangle", 0.4), i * 110));
  }
  lose() {
    [392, 311, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, "sawtooth", 0.35), i * 130));
  }
}

export const audio = new AudioManager();
