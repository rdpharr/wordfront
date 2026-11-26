import { assetUrl, type Manifest } from "./assets";
import type { Settings } from "./storage";

export type Track = "title" | "game";

/** music sits under the effects; this is its level at 100% on the slider */
const MUSIC_LEVEL = 0.275;
const DUCKED = 0.3;

/**
 * Sound effects are synthesised with Web Audio, so a keystroke sound starts within
 * a frame of the keypress and nothing needs loading. Music is decoded up front and
 * looped sample-accurately with AudioBufferSourceNode (an <audio loop> leaves a gap).
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private sfx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private tracks: Partial<Record<Track, AudioBuffer>> = {};
  private loopEnd: Partial<Record<Track, number>> = {};
  private playing: { track: Track; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wanted: Track | null = null;
  private ducked = false;

  constructor(private settings: () => Settings) {}

  /**
   * Create the audio graph and decode the music. The context starts suspended
   * until unlock() runs from a user gesture.
   */
  async init(manifest: Manifest): Promise<void> {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.sfx = ctx.createGain();
    this.sfx.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolume();

    // the gameplay loop fades out over its last ~0.15 s: loop just before that
    this.loopEnd.game = manifest.music_game.duration - 0.2;
    this.loopEnd.title = manifest.music_title.duration;
    await Promise.all(
      (["title", "game"] as const).map(async (t) => {
        const file = t === "game" ? "music_game.ogg" : "music_title.ogg";
        const buf = await fetch(assetUrl(file)).then((r) => r.arrayBuffer());
        this.tracks[t] = await ctx.decodeAudioData(buf);
      }),
    );
    if (this.wanted) this.startTrack(this.wanted);
  }

  /** Must be called from a user gesture (browsers block audio before one). */
  unlock(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  applyVolume(): void {
    const s = this.settings();
    const t = this.ctx?.currentTime ?? 0;
    this.sfx?.gain.setTargetAtTime(s.muted ? 0 : s.sfxVolume, t, 0.02);
    const music = s.muted ? 0 : s.musicVolume * MUSIC_LEVEL * (this.ducked ? DUCKED : 1);
    this.musicBus?.gain.setTargetAtTime(music, t, 0.08);
  }

  /** Crossfade to a track (no-op if it's already playing). null fades music out. */
  music(track: Track | null, fade = 0.6): void {
    this.wanted = track;
    if (this.playing?.track === track) return;
    this.stopCurrent(fade);
    if (track) this.startTrack(track, fade);
  }

  /** Lower the music while paused. */
  duck(on: boolean): void {
    this.ducked = on;
    this.applyVolume();
  }

  private startTrack(track: Track, fade = 0.6): void {
    const c = this.ctx;
    const buf = this.tracks[track];
    if (!c || !buf || !this.musicBus || this.playing?.track === track) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = Math.min(buf.duration, this.loopEnd[track] ?? buf.duration);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(1, c.currentTime + fade);
    src.connect(gain).connect(this.musicBus);
    src.start();
    this.playing = { track, src, gain };
  }

  private stopCurrent(fade: number): void {
    const c = this.ctx;
    const p = this.playing;
    if (!c || !p) return;
    const t = c.currentTime;
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(p.gain.gain.value, t);
    p.gain.gain.linearRampToValueAtTime(0, t + fade);
    p.src.stop(t + fade + 0.05);
    this.playing = null;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    const c = this.ctx;
    if (!c || !this.sfx) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, filterFreq: number, q = 1): void {
    const c = this.ctx;
    if (!c || !this.sfx || !this.noise) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Rifle pop for a correct letter; pitch rises with the multiplier. */
  shot(multiplier: number): void {
    this.burst(0.06, 0.5, 1800 + multiplier * 500, 0.8);
    this.tone(320 + multiplier * 110, 0.05, "square", 0.08, 160);
  }

  miss(): void {
    this.tone(140, 0.07, "square", 0.12, 90);
  }

  /** Wrong letter: the rifles jam with a dry metallic click-clack. */
  jam(): void {
    this.burst(0.03, 0.35, 3200, 0.9);
    this.tone(140, 0.07, "square", 0.12, 90);
    setTimeout(() => this.burst(0.03, 0.25, 2400, 0.9), 90);
  }

  /** A letter dropped while jammed: a faint dead click. */
  jammedKey(): void {
    this.burst(0.02, 0.12, 2000, 0.9);
  }

  kill(): void {
    this.burst(0.25, 0.4, 600, 0.7);
    this.tone(260, 0.22, "sawtooth", 0.06, 70);
  }

  bossRoar(): void {
    this.tone(90, 0.7, "sawtooth", 0.12, 45);
    this.burst(0.6, 0.15, 300, 0.5);
  }

  airstrike(): void {
    this.burst(1.0, 0.8, 140, 0.4);
    this.tone(70, 0.9, "sine", 0.5, 30);
  }

  incoming(): void {
    this.tone(880, 0.09, "square", 0.09, 660);
    setTimeout(() => this.tone(880, 0.09, "square", 0.09, 660), 120);
  }

  airstrikeEarned(): void {
    [440, 660].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, "square", 0.1), i * 70));
  }

  /** Bugle call when an airstrike sends the wave back to the start. */
  waveReset(): void {
    [330, 330, 494, 440].forEach((f, i) =>
      setTimeout(() => this.tone(f, i === 3 ? 0.32 : 0.13, "sawtooth", 0.11), [0, 150, 300, 470][i]),
    );
  }

  fanfare(): void {
    [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, "triangle", 0.15), i * 90));
  }

  gameOver(): void {
    [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, "triangle", 0.16), i * 180));
  }
}
