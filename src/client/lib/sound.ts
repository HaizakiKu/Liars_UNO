import { create } from "zustand";

/** Tiny synthesized sound kit — no audio files to load. */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (useSound.getState().muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noise(a: AudioContext, dur: number, freq: number, q: number, gain: number, when = 0) {
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(a.currentTime + when);
}

function tone(a: AudioContext, freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  const t0 = a.currentTime + when;
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const sfx = {
  card() {
    const a = audio();
    if (a) noise(a, 0.09, 2600, 0.9, 0.5);
  },
  draw() {
    const a = audio();
    if (a) noise(a, 0.12, 1500, 0.7, 0.35);
  },
  flip() {
    const a = audio();
    if (!a) return;
    noise(a, 0.05, 3200, 1.2, 0.35);
    noise(a, 0.06, 2200, 1.2, 0.3, 0.07);
  },
  challenge() {
    const a = audio();
    if (!a) return;
    tone(a, 120, 0.35, "sine", 0.5, 0, 45);
    noise(a, 0.2, 400, 0.6, 0.4);
  },
  truth() {
    const a = audio();
    if (!a) return;
    tone(a, 784, 0.5, "sine", 0.18);
    tone(a, 1175, 0.6, "sine", 0.12, 0.08);
  },
  lie() {
    const a = audio();
    if (!a) return;
    tone(a, 220, 0.42, "sawtooth", 0.09, 0, 110);
    tone(a, 233, 0.42, "square", 0.05, 0, 104);
  },
  uno() {
    const a = audio();
    if (!a) return;
    [660, 880, 1320].forEach((f, i) => tone(a, f, 0.22, "triangle", 0.16, i * 0.07));
  },
  turn() {
    const a = audio();
    if (a) tone(a, 740, 0.28, "sine", 0.12);
  },
  tick() {
    const a = audio();
    if (a) tone(a, 1400, 0.04, "square", 0.03);
  },
  win() {
    const a = audio();
    if (!a) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(a, f, 0.4, "triangle", 0.15, i * 0.11));
  },
  pop() {
    const a = audio();
    if (a) tone(a, 520, 0.12, "sine", 0.14, 0, 880);
  },
};

export const useSound = create<{ muted: boolean; toggle: () => void }>((set, get) => ({
  muted: (() => {
    try {
      return localStorage.getItem("luno.muted") === "1";
    } catch {
      return false;
    }
  })(),
  toggle: () => {
    const muted = !get().muted;
    try {
      localStorage.setItem("luno.muted", muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ muted });
  },
}));
