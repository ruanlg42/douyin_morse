/* Web Audio 摩斯电报音 —— 温暖 CW 电键音 */

let _morseAudioCtx = null;
let _morseOsc = null;
let _morseGain = null;
let _morseExtras = [];

const _ensureAudio = () => {
  if (_morseAudioCtx) return _morseAudioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    _morseAudioCtx = new Ctx();
  } catch (_) {
    _morseAudioCtx = null;
  }
  return _morseAudioCtx;
};

export const getMorseAudioContext = _ensureAudio;

export const startMorseTone = (baseFreq = 660) => {
  const ctx = _ensureAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    if (_morseOsc) {
      try { _morseOsc.stop(); } catch (_) {}
      _morseExtras.forEach(n => { try { n.stop(); } catch (_) {} });
      _morseOsc = null; _morseGain = null; _morseExtras = [];
    }
    const now = ctx.currentTime;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, now);
    filter.Q.setValueAtTime(0.6, now);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(5.0, now);
    lfoGain.gain.setValueAtTime(1.6, now);
    lfo.connect(lfoGain);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    lfoGain.connect(osc.frequency);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(baseFreq * 2, now);
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.05, now);

    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(baseFreq * 0.5, now);
    const gain3 = ctx.createGain();
    gain3.gain.setValueAtTime(0.07, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.022);

    osc.connect(gain);
    osc2.connect(gain2).connect(gain);
    osc3.connect(gain3).connect(gain);
    gain.connect(filter);
    filter.connect(ctx.destination);

    osc.start(now);
    osc2.start(now);
    osc3.start(now);
    lfo.start(now);

    _morseOsc = osc;
    _morseGain = gain;
    _morseExtras = [osc2, osc3, lfo];
  } catch (_) {}
};

export const rampMorseTone = (intensity) => {
  if (!_morseAudioCtx || !_morseOsc || !_morseGain) return;
  try {
    const t = _morseAudioCtx.currentTime;
    _morseGain.gain.cancelScheduledValues(t);
    _morseGain.gain.setTargetAtTime(0.22 + intensity * 0.06, t, 0.08);
    _morseOsc.frequency.cancelScheduledValues(t);
    _morseOsc.frequency.setTargetAtTime(660 + intensity * 40, t, 0.15);
  } catch (_) {}
};

export const stopMorseTone = () => {
  if (!_morseAudioCtx || !_morseOsc || !_morseGain) return;
  try {
    const t = _morseAudioCtx.currentTime;
    _morseGain.gain.cancelScheduledValues(t);
    _morseGain.gain.setValueAtTime(_morseGain.gain.value, t);
    _morseGain.gain.exponentialRampToValueAtTime(0.0008, t + 0.06);
    _morseOsc.stop(t + 0.08);
    _morseExtras.forEach(n => { try { n.stop(t + 0.08); } catch (_) {} });
  } catch (_) {}
  _morseOsc = null;
  _morseGain = null;
  _morseExtras = [];
};
