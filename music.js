// Musik für Iischi Party.
// Die Musik ist die Uhr des Spiels: Jede Note liegt auf einem Schlag (siehe logic.js, setup),
// und das Spiel liest die Zeit aus dem AudioContext. So können Noten und Musik nicht auseinanderlaufen.
//
// Ein Lied startet so, dass "Spielzeit 0" genau auf Schlag 0 fällt. Bei Spielzeit t läuft Schlag t / (60 / bpm).

export const TRACKS = [
  // Gemessen: 124 BPM, erster Schlag bei 0,018 s, nahtlose Schleife nach 62 Schlägen (30,0 s).
  { id: 'party', name: 'Party Track', style: 'Original', bpm: 124, kind: 'file', src: 'assets/party-track.mp3', firstBeat: 0.018, loopBeats: 62 },
  { id: 'disco', name: 'Disco Fieber', style: 'Disco', bpm: 126, kind: 'synth' },
  { id: 'rave', name: '90s Rave', style: 'Eurodance', bpm: 132, kind: 'synth' },
  { id: 'huette', name: 'Hüttenparty', style: 'Schlager', bpm: 128, kind: 'synth' },
];

export const trackById = id => TRACKS.find(t => t.id === id) || TRACKS[0];

const LOOKAHEAD = 0.15;   // Sekunden, die der Synthesizer im Voraus plant
const PHASE_BEATS = [36, 64, 96]; // Disco / 90s / Mitsingfinale wie im Notenplan (Menü-Schleife: 96 Schläge)

const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const mod = (a, n) => ((a % n) + n) % n;

// Akkordfolgen: [Grundton als MIDI-Note, Dur (true) oder Moll (false)] pro Takt
const SONGS = {
  disco: {
    bars: [[57, false], [53, true], [48, true], [55, true]], // Am F C G
  },
  rave: {
    bars: [[50, false], [46, true], [48, true], [45, false]], // Dm Bb C Am
  },
  huette: {
    bars: [[48, true], [43, true], [43, true], [48, true], [41, true], [48, true], [43, true], [48, true]], // C G G C F C G C
  },
};

export function createMusic() {
  let ctx = null, out = null, fileOut = null, noise = null;
  const buffers = new Map();
  const voices = new Set();
  let current = null; // { track, origin, nextStep, timer, source }

  function attach(audioContext) {
    if (ctx === audioContext) return;
    ctx = audioContext;
    out = ctx.createGain(); out.gain.value = 0.2; out.connect(ctx.destination);
    fileOut = ctx.createGain(); fileOut.gain.value = 0.38; fileOut.connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }

  async function load(track) {
    if (track.kind !== 'file' || !ctx) return null;
    if (buffers.has(track.id)) return buffers.get(track.id);
    const response = await fetch(track.src);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    buffers.set(track.id, buffer);
    return buffer;
  }

  function keep(node, ...extra) {
    voices.add(node);
    node.onended = () => {
      voices.delete(node);
      try { node.disconnect(); extra.forEach(n => n.disconnect()); } catch {}
    };
  }

  // ---------- Instrumente ----------
  function kick(at, vol = 1) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.13);
    g.gain.setValueAtTime(0.95 * vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
    o.connect(g); g.connect(out); keep(o, g); o.start(at); o.stop(at + 0.24);
  }
  function hiss(at, { len = 0.05, vol = 0.12, type = 'highpass', freq = 7000, q = 0.7 } = {}) {
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + len);
    n.connect(f); f.connect(g); g.connect(out); keep(n, f, g); n.start(at, Math.random() * 0.3); n.stop(at + len + 0.02);
  }
  const hat = (at, open = false, vol = 0.1) => hiss(at, { len: open ? 0.16 : 0.035, vol, freq: 7500 });
  const clap = (at, vol = 0.32) => hiss(at, { len: 0.12, vol, type: 'bandpass', freq: 1500, q: 0.9 });
  const snare = (at, vol = 0.28) => { hiss(at, { len: 0.14, vol, type: 'bandpass', freq: 2200, q: 0.6 }); tone(190, at, 0.08, vol * 0.6, 'triangle'); };
  function tone(hz, at, len, vol, type = 'triangle', cutoff = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    let last = o;
    if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); last = f; keep(o, f, g); }
    else keep(o, g);
    last.connect(g); g.connect(out); o.start(at); o.stop(at + len + 0.03);
  }
  function chord(root, major, at, len, vol, type, octave, cutoff) {
    const third = major ? 4 : 3;
    [0, third, 7].forEach(i => tone(midi(root + 12 * octave + i), at, len, vol, type, cutoff));
  }

  // ---------- Muster (ein Schritt = Sechzehntel) ----------
  function playStep(id, k, at, beatLen) {
    const s = ((k % 16) + 16) % 16;               // Position im Takt
    const beat = Math.floor(k / 4);
    const loopBeat = ((beat % 96) + 96) % 96;
    const phase = loopBeat < PHASE_BEATS[0] ? 0 : loopBeat < PHASE_BEATS[1] ? 1 : 2;
    const song = SONGS[id];
    const barIndex = Math.floor(k / 16);
    const [root, major] = song.bars[((barIndex % song.bars.length) + song.bars.length) % song.bars.length];
    const sixteenth = beatLen / 4;
    const arp = [0, major ? 4 : 3, 7, 12];

    if (id === 'disco') {
      if (s % 4 === 0) kick(at);
      if (s === 4 || s === 12) clap(at);
      if (s % 4 === 2) hat(at, true, 0.09);
      if (phase >= 1 && s % 2 === 1) hat(at, false, 0.05);
      if (s % 2 === 0) tone(midi(root - 12 + (s % 4 === 0 ? 0 : 12)), at, sixteenth * 1.7, 0.3, 'sawtooth', 900);
      if (s === 0) chord(root, major, at, beatLen * 3.6, 0.045, 'sawtooth', 0, 2400);
      if (phase >= 1 && (s === 6 || s === 14)) chord(root, major, at, sixteenth * 1.5, 0.07, 'square', 1, 3000);
      if (phase >= 2 && s % 2 === 0) tone(midi(root + 24 + arp[mod(s / 2, 4)]), at, sixteenth * 1.5, 0.05, 'triangle');
    } else if (id === 'rave') {
      if (s % 4 === 0) kick(at);
      if (s % 4 === 2) { tone(midi(root - 12), at, sixteenth * 1.8, 0.32, 'sawtooth', 700); hat(at, true, 0.08); }
      if (phase >= 1 && (s === 4 || s === 12)) clap(at, 0.26);
      if (phase >= 1 && s % 4 !== 2) hat(at, false, 0.045);
      if (phase >= 1 && [0, 3, 6, 10].includes(s)) chord(root, major, at, sixteenth * 2.2, 0.06, 'square', 1, 2800);
      if (phase === 0 && s === 0) chord(root, major, at, beatLen * 3.6, 0.04, 'sawtooth', 1, 1800);
      if (phase >= 2 && s % 2 === 0) tone(midi(root + 24 + arp[mod(s / 2 + barIndex, 4)]), at, sixteenth * 1.6, 0.055, 'sawtooth', 4000);
    } else if (id === 'huette') {
      if (s === 0 || s === 8) kick(at, 0.9);
      if (s === 4 || s === 12) snare(at);
      if (s === 0 || s === 8) tone(midi(root - 12 + (s === 8 ? 7 : 0)), at, beatLen * 0.8, 0.34, 'triangle');
      if (s % 4 === 2) chord(root, major, at, sixteenth * 1.6, 0.05, 'square', 1, 2200);
      if (phase >= 1 && s % 2 === 0) hiss(at, { len: 0.06, vol: 0.06, type: 'bandpass', freq: 9000, q: 2 });
      if (phase >= 2 && s % 4 === 0) tone(midi(root + 24 + arp[mod(s / 4, 4)]), at, beatLen * 0.7, 0.06, 'sine');
    }
  }

  function schedule() {
    if (!current || current.track.kind !== 'synth') return;
    const beatLen = 60 / current.track.bpm, step = beatLen / 4;
    const until = ctx.currentTime + LOOKAHEAD;
    while (current.origin + current.nextStep * step < until) {
      const k = current.nextStep++;
      const at = current.origin + k * step;
      if (at >= ctx.currentTime - 0.01) playStep(current.track.id, k, Math.max(at, ctx.currentTime), beatLen);
    }
  }

  function stop() {
    if (!current) return;
    clearInterval(current.timer);
    if (current.source) { try { current.source.stop(); } catch {} }
    voices.forEach(v => { try { v.stop(); } catch {} });
    voices.clear();
    current = null;
  }

  // Startet das Lied so, dass die Spielzeit `from` (Sekunden, darf negativ sein = Vorlauf)
  // zum AudioContext-Zeitpunkt `when` erklingt. Gibt den Ursprung zurück: Spielzeit 0 = Ursprung.
  async function play(track, from, when) {
    stop();
    if (!ctx) return null;
    const token = {};
    current = { track, token, origin: when - from, nextStep: 0, timer: 0, source: null };
    if (track.kind === 'file') {
      const buffer = await load(track);
      if (!current || current.token !== token) return null;
      const loopLen = track.loopBeats * 60 / track.bpm;
      // Verspätetes Laden: Startzeit und Position gemeinsam nach hinten schieben.
      const startAt = Math.max(when, ctx.currentTime + 0.03);
      const musicTime = from + (startAt - when);
      const pos = (((track.firstBeat + musicTime) % loopLen) + loopLen) % loopLen;
      const src = ctx.createBufferSource();
      src.buffer = buffer; src.loop = true; src.loopStart = 0; src.loopEnd = loopLen;
      src.connect(fileOut); src.start(startAt, pos);
      current.source = src;
    } else {
      const step = 60 / track.bpm / 4;
      current.nextStep = Math.ceil(from / step);
      schedule();
      current.timer = setInterval(schedule, 25);
    }
    return current.origin;
  }

  return {
    attach, load, play, stop,
    get playing() { return Boolean(current); },
    get origin() { return current ? current.origin : null; },
    // Hörbare Spielzeit (berücksichtigt die Ausgabeverzögerung des Geräts)
    now() {
      if (!ctx || !current) return null;
      const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      return ctx.currentTime - latency - current.origin;
    },
  };
}
