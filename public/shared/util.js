// Shared tiny helpers for all three clients.
export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function clientId() {
  let id = localStorage.getItem('ptg_clientId');
  if (!id) {
    id = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('ptg_clientId', id);
  }
  return id;
}

export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const kid of kids) node.append(kid?.nodeType ? kid : document.createTextNode(kid ?? ''));
  return node;
}

// Sound engine. Prefers a real MP3 if you drop one in /shared/sfx/<kind>.mp3;
// otherwise plays a richly-synthesized sound through a master chain
// (compressor + reverb send) so it sounds produced, not like a toy.
let actx = null;
let master = null;        // everything routes here
const sfxBuffers = {};    // kind -> decoded AudioBuffer (if a file exists)
let sfxLoadStarted = false;
const SFX_FILES = {
  buzz: '/shared/sfx/buzz.mp3',
  correct: '/shared/sfx/correct.mp3',
  wrong: '/shared/sfx/wrong.mp3',
  open: '/shared/sfx/open.mp3',
  win: '/shared/sfx/win.mp3',
};

export function initAudio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    buildMaster();
  }
  if (actx && actx.state === 'suspended') actx.resume();
  if (actx && !sfxLoadStarted) { sfxLoadStarted = true; loadSfxFiles(); }
}

function buildMaster() {
  master = actx.createGain();
  master.gain.value = 0.9;
  const comp = actx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 3;
  comp.attack.value = 0.003; comp.release.value = 0.25;
  master.connect(comp).connect(actx.destination);
  // parallel reverb send for space/polish
  const reverb = actx.createConvolver();
  reverb.buffer = makeImpulse(0.55, 2.6);
  const revGain = actx.createGain();
  revGain.gain.value = 0.16;
  master.connect(reverb).connect(revGain).connect(comp);
}

function makeImpulse(seconds, decay) {
  const rate = actx.sampleRate, len = Math.max(1, Math.floor(rate * seconds));
  const buf = actx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

async function loadSfxFiles() {
  for (const [kind, url] of Object.entries(SFX_FILES)) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;                 // no file → keep synth fallback
      const data = await res.arrayBuffer();
      sfxBuffers[kind] = await actx.decodeAudioData(data);
    } catch { /* no file / decode fail → synth fallback */ }
  }
}

export function beep(kind = 'buzz') {
  if (!actx || !master) return;
  if (sfxBuffers[kind]) {                     // real recording wins
    const src = actx.createBufferSource();
    const g = actx.createGain(); g.gain.value = 0.95;
    src.buffer = sfxBuffers[kind];
    src.connect(g).connect(master);
    src.start();
    return;
  }
  ({ buzz: sBuzz, correct: sCorrect, wrong: sWrong, open: sOpen, win: sWin }[kind] || sCorrect)();
}

// ---- synth voices ----
// A meaty game-show klaxon: detuned saw stack through a resonant lowpass with
// a slow tremolo wobble — the classic "EHHHNK" buzz-in, not a toy beep.
function sBuzz() {
  const t = actx.currentTime, dur = 0.5;
  const lp = actx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1900; lp.Q.value = 7;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.6, t + 0.012);
  g.gain.setValueAtTime(0.6, t + dur - 0.09);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  lp.connect(g).connect(master);
  [110, 165, 220].forEach((f, i) => {
    const o = actx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (i - 1) * 7;
    o.connect(lp); o.start(t); o.stop(t + dur);
  });
  const lfo = actx.createOscillator(); lfo.frequency.value = 11;
  const lg = actx.createGain(); lg.gain.value = 140;
  lfo.connect(lg).connect(lp.frequency); lfo.start(t); lfo.stop(t + dur);
}

// Bright two-note bell (inharmonic partials + long decay) = "correct!".
function sCorrect() {
  const t = actx.currentTime;
  bell(1046.5, t, 0.7);          // C6
  bell(1318.5, t + 0.11, 0.8);   // E6
}
function bell(freq, start, dur) {
  [[1, 1], [2, 0.5], [2.76, 0.32], [3.52, 0.2], [5.4, 0.12]].forEach(([r, a]) => {
    const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * r;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.22 * a, start + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(master); o.start(start); o.stop(start + dur);
  });
}

// Classic descending "wamp-wamp" wrong-answer buzzer (pitch-bent saws + lowpass).
function sWrong() {
  const t = actx.currentTime;
  [[207, 0, 0.24], [164, 0.24, 0.34]].forEach(([f, off, dur]) => {
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = 2;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t + off);
    g.gain.exponentialRampToValueAtTime(0.5, t + off + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + off + dur);
    lp.connect(g).connect(master);
    [f, f * 1.006].forEach((fr) => {
      const o = actx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(fr, t + off);
      o.frequency.linearRampToValueAtTime(fr * 0.93, t + off + dur);
      o.connect(lp); o.start(t + off); o.stop(t + off + dur);
    });
  });
}

// Quick bright "ready" blip when buzzers open.
function sOpen() {
  const t = actx.currentTime;
  [[660, 0], [988, 0.07]].forEach(([f, off]) => {
    const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t + off);
    g.gain.exponentialRampToValueAtTime(0.3, t + off + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.18);
    o.connect(g).connect(master); o.start(t + off); o.stop(t + off + 0.2);
  });
}

// Brass-like rising fanfare into a final chord = "winner!".
function sWin() {
  const t = actx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => brass(f, t + i * 0.12, 0.2));
  [523.25, 659.25, 783.99, 1046.5].forEach((f) => brass(f, t + 0.52, 0.8));
}
function brass(freq, start, dur) {
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1;
  lp.frequency.setValueAtTime(700, start);
  lp.frequency.linearRampToValueAtTime(3600, start + 0.09);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(0.2, start + 0.03);
  g.gain.setValueAtTime(0.2, start + dur - 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  lp.connect(g).connect(master);
  [freq, freq * 1.007, freq * 0.5].forEach((fr, i) => {
    const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = (i - 1) * 8;
    o.connect(lp); o.start(start); o.stop(start + dur);
  });
}

export function confettiBurst(color = '#ffd23f', count = 120) {
  const root = el('div', { class: 'confetti-root' });
  document.body.append(root);
  const colors = [color, '#ff4d8d', '#2bd97c', '#4ea3ff', '#ffffff'];
  for (let i = 0; i < count; i++) {
    const p = el('i');
    const c = colors[i % colors.length];
    p.style.cssText = `position:absolute;top:-10px;left:${Math.random() * 100}%;width:${6 + Math.random() * 8}px;height:${8 + Math.random() * 10}px;background:${c};opacity:.95;transform:rotate(${Math.random() * 360}deg);border-radius:2px;`;
    const dur = 1500 + Math.random() * 1800;
    p.animate(
      [
        { transform: `translateY(0) rotate(0deg)`, opacity: 1 },
        { transform: `translateY(105vh) rotate(${720 + Math.random() * 720}deg)`, opacity: 0.9 },
      ],
      { duration: dur, easing: 'cubic-bezier(.2,.6,.4,1)', delay: Math.random() * 250 }
    );
    root.append(p);
  }
  setTimeout(() => root.remove(), 3800);
}
