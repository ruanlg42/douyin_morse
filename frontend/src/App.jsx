import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, Share2, ChevronLeft, ChevronRight, ChevronsRight, ArrowRight, Zap, Shuffle, List, ListOrdered, Repeat, Repeat1, Delete, GraduationCap, Target, Music2, Sparkles, Check, X, Volume2, VolumeX, Flame, RotateCcw } from 'lucide-react';
import { apiUrl } from './api.js';
import staticQuizData from '../../data/static-quiz.json';

// 26 letters -> morse map
const MORSE_MAP = {
  A: '.-',   B: '-...', C: '-.-.', D: '-..',  E: '.',
  F: '..-.', G: '--.',  H: '....', I: '..',  J: '.---',
  K: '-.-',  L: '.-..', M: '--',  N: '-.',  O: '---',
  P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-',  V: '...-', W: '.--', X: '-..-', Y: '-.--',
  Z: '--..',
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** 摩斯点划串 → 字母（无效则 undefined） */
const MORSE_TO_LETTER = Object.fromEntries(
  Object.entries(MORSE_MAP).map(([letter, pat]) => [pat, letter]),
);

const CELEBRATION_SLOGANS = [
  { text: 'Great',     icon: Sparkles },
  { text: 'Perfect',   icon: Sparkles },
  { text: 'Awesome',   icon: Zap },
  { text: 'Excellent', icon: Sparkles },
  { text: 'Brilliant', icon: Sparkles },
  { text: 'Superb',    icon: Zap },
];

const TABS = [
  { id: 'learn', label: 'Learn', icon: GraduationCap },
  { id: 'music', label: 'Music', icon: Music2 },
  { id: 'play',  label: '猜码',  icon: Target },
];

/** Gentle haptic — safe (noop where unsupported). */
const haptic = (pattern = 8) => {
  if (typeof navigator === 'undefined') return;
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
};

/* ===== Web Audio 摩斯电报音 —— 温暖 CW 电键音，按下发声、松开停音 ===== */
let _morseAudioCtx = null;
let _morseOsc = null;        // 基频振荡器（主，用于停止引用）
let _morseGain = null;       // 主包络增益（用于停止引用）
let _morseExtras = [];       // 辅助节点：泛音/次谐波/LFO 等（统一 stop）

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

/**
 * 启动电键音：基频 660 Hz 正弦 + 2 次/次谐音（sub + 八度）+ 轻微颤音 + 低通柔化
 * 软包络（~22ms 起音）杜绝爆点；低通滤波削去刺耳高频，听感接近真实 HAM 电报机。
 */
const startMorseTone = (baseFreq = 660) => {
  const ctx = _ensureAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    // 先停掉上一个残余节点
    if (_morseOsc) {
      try { _morseOsc.stop(); } catch (_) {}
      _morseExtras.forEach(n => { try { n.stop(); } catch (_) {} });
      _morseOsc = null; _morseGain = null; _morseExtras = [];
    }
    const now = ctx.currentTime;

    // 低通柔化（2.6k，Q 低一点不出现峰）
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, now);
    filter.Q.setValueAtTime(0.6, now);

    // 颤音 LFO（5 Hz，±1.6 cents 深度，活泼但不夸张）
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(5.0, now);
    lfoGain.gain.setValueAtTime(1.6, now);
    lfo.connect(lfoGain);

    // 基频正弦
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    lfoGain.connect(osc.frequency);

    // 2nd 八度泛音，轻微加亮（-26dB 量级）
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(baseFreq * 2, now);
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.05, now);

    // sub 次谐音（-23dB），增加厚度
    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(baseFreq * 0.5, now);
    const gain3 = ctx.createGain();
    gain3.gain.setValueAtTime(0.07, now);

    // 主增益包络 —— 22ms 软起音
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

/** 长按能量递增 —— 随按压强度(0~1)把音色提亮、微升频、滤波打开 */
const rampMorseTone = (intensity) => {
  if (!_morseAudioCtx || !_morseOsc || !_morseGain) return;
  try {
    const t = _morseAudioCtx.currentTime;
    // 滤波频率在 2600Hz -> 4600Hz 之间滑动（越长按越明亮）
    const filters = _morseExtras; // LFO 在此，但无 filter 引用；直接保留当前节点即可
    // 直接小幅提升主增益 0.22 -> 0.28 制造"蓄力"音量感
    _morseGain.gain.cancelScheduledValues(t);
    _morseGain.gain.setTargetAtTime(0.22 + intensity * 0.06, t, 0.08);
    // 基频轻微上滑 660 -> 700 Hz
    _morseOsc.frequency.cancelScheduledValues(t);
    _morseOsc.frequency.setTargetAtTime(660 + intensity * 40, t, 0.15);
  } catch (_) {}
};

const stopMorseTone = () => {
  if (!_morseAudioCtx || !_morseOsc || !_morseGain) return;
  try {
    const t = _morseAudioCtx.currentTime;
    _morseGain.gain.cancelScheduledValues(t);
    _morseGain.gain.setValueAtTime(_morseGain.gain.value, t);
    // exp 衰减尾音，听感更自然
    _morseGain.gain.exponentialRampToValueAtTime(0.0008, t + 0.06);
    _morseOsc.stop(t + 0.08);
    _morseExtras.forEach(n => { try { n.stop(t + 0.08); } catch (_) {} });
  } catch (_) {}
  _morseOsc = null;
  _morseGain = null;
  _morseExtras = [];
};

/** 答对三音上扬和弦（A5 → D6 → G6） */
const playSuccessChime = () => {
  const ctx = _ensureAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    const now = ctx.currentTime;
    const notes = [880, 1175, 1568];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      gain.gain.setValueAtTime(0, now + i * 0.08);
      gain.gain.linearRampToValueAtTime(0.18, now + i * 0.08 + 0.015);
      gain.gain.linearRampToValueAtTime(0, now + i * 0.08 + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.32);
    });
  } catch (_) {}
};

/** 答错下坠低鸣 */
const playWrongBuzz = () => {
  const ctx = _ensureAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.26);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.33);
  } catch (_) {}
};

/** 成就达成短促金铃铛（连击阈值） */
const playAchievementBell = () => {
  const ctx = _ensureAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    const now = ctx.currentTime;
    [1760, 2349, 2637].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.04);
      gain.gain.setValueAtTime(0, now + i * 0.04);
      gain.gain.linearRampToValueAtTime(0.12, now + i * 0.04 + 0.01);
      gain.gain.linearRampToValueAtTime(0, now + i * 0.04 + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.04);
      osc.stop(now + i * 0.04 + 0.5);
    });
  } catch (_) {}
};

/** Fire a tap-ripple on a button (uses global .ripple/.is-rippling CSS). */
const triggerRipple = (e) => {
  const el = e.currentTarget;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const p = e.touches?.[0] || e.changedTouches?.[0] || e;
  const rx = ((p.clientX ?? rect.left + rect.width / 2) - rect.left) / rect.width * 100;
  const ry = ((p.clientY ?? rect.top + rect.height / 2) - rect.top) / rect.height * 100;
  el.style.setProperty('--rx', rx + '%');
  el.style.setProperty('--ry', ry + '%');
  el.classList.remove('is-rippling');
  void el.offsetWidth;
  el.classList.add('is-rippling');
};

const App = () => {
  const [activeTab, setActiveTab] = useState('learn');

  return (
    <div className="app-page w-full selection:bg-[var(--gold-300)]/25" style={{ color: 'var(--text)' }}>
      <div className="phone-shell">
        <div className="phone-screen">
          <div className="phone-status-bar" aria-hidden>
            <div className="phone-punch" />
          </div>

          <div className="phone-content">
            {/* Tab bar */}
            <div className="relative z-50 px-5 pt-1 pb-2 flex-shrink-0">
              <div
                className="glass-chip flex items-center p-1"
                role="tablist"
                aria-label="主导航"
              >
                {TABS.map(({ id, label, icon: Icon }) => {
                  const active = activeTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-controls={`panel-${id}`}
                      onClick={(e) => {
                        if (!active) { haptic(6); triggerRipple(e); }
                        setActiveTab(id);
                      }}
                      className="ripple relative flex-1 h-9 rounded-full text-sm font-medium flex items-center justify-center gap-1.5 transition-all duration-300 ease-out"
                      style={{
                        margin: '2px',
                        ...(active
                          ? {
                              background: 'linear-gradient(135deg, #f2d27a 0%, #d4a747 100%)',
                              color: '#1a1a1a',
                              boxShadow: '0 6px 18px rgba(217, 201, 163, 0.35), inset 0 1px 0 rgba(255,255,255,0.35)',
                            }
                          : {
                              background: 'transparent',
                              color: 'var(--accent-soft)',
                            }),
                      }}
                    >
                      <Icon className="w-3.5 h-3.5" strokeWidth={active ? 2.4 : 2} />
                      <span className="tracking-wide">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 三个 panel 全部持续挂载，仅靠 display 切换——
                这样用户在 Music 生成音乐中途切到 Learn/Play 查看，再回来仍保留全部状态（表单、生成结果、播放进度等）。
                display:none 比 visibility:hidden 更干净：彻底不参与布局/渲染，避免切换时上一个 tab 的内容"残影"漏出到新 tab。 */}
            <div className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
              <div
                className={`absolute inset-0 flex-col ${activeTab === 'learn' ? 'tab-enter' : ''}`}
                style={{ display: activeTab === 'learn' ? 'flex' : 'none' }}
                aria-hidden={activeTab !== 'learn'}
              >
                <LearnScreen isActive={activeTab === 'learn'} />
              </div>
              <div
                className={`absolute inset-0 flex-col ${activeTab === 'music' ? 'tab-enter' : ''}`}
                style={{ display: activeTab === 'music' ? 'flex' : 'none' }}
                aria-hidden={activeTab !== 'music'}
              >
                <MusicScreen isActive={activeTab === 'music'} />
              </div>
              <div
                className={`absolute inset-0 flex-col ${activeTab === 'play' ? 'tab-enter' : ''}`}
                style={{ display: activeTab === 'play' ? 'flex' : 'none' }}
                aria-hidden={activeTab !== 'play'}
              >
                <PlayScreen isActive={activeTab === 'play'} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* =========================================================
   LearnScreen — 学习 / 测试
   ========================================================= */
const LearnScreen = ({ isActive = true }) => {
  const [mode, setMode] = useState('learn');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  // 播放模式：sequence（顺序 A→Z）或 loop（当前字母循环）
  const [playMode, setPlayMode] = useState('sequence');
  const playModeRef = useRef('sequence');
  useEffect(() => { playModeRef.current = playMode; }, [playMode]);
  // 视频声音开关（默认开启；若浏览器阻止带声自动播放，用户点 ▶ 即可正常带声播放）
  const [soundOn, setSoundOn] = useState(true);
  const videoRef = useRef(null);
  const autoPlayTimerRef = useRef(null);

  const [celebration, setCelebration] = useState(null);
  const celebrationTimerRef = useRef(null);

  const [testLetter, setTestLetter] = useState(null);
  const [testInput, setTestInput] = useState([]);
  const [testScore, setTestScore] = useState(0);
  const [testTotal, setTestTotal] = useState(0);
  const [testResult, setTestResult] = useState(null);
  const [testSeqMode, setTestSeqMode] = useState('random');
  const [testSeqIndex, setTestSeqIndex] = useState(0);
  const [testStreak, setTestStreak] = useState(0);
  const [testBestStreak, setTestBestStreak] = useState(0);
  const [testTotalScore, setTestTotalScore] = useState(0);
  const [testQuestionStartTime, setTestQuestionStartTime] = useState(null);
  const [testSpeedScore, setTestSpeedScore] = useState(null);
  // 浮动加分提示（每次答对触发）
  const [floatPoints, setFloatPoints] = useState(null);
  // 摇晃动画触发 key（答错时递增以重启 CSS 动画）
  const [shakeTick, setShakeTick] = useState(0);
  // 成就 banner（连击里程碑）
  const [achievement, setAchievement] = useState(null);
  const achievementTimerRef = useRef(null);

  const [isPressing, setIsPressing] = useState(false);
  const [pressIntensity, setPressIntensity] = useState(0);
  const pressStartRef = useRef(null);
  const intensityTimerRef = useRef(null);

  const currentLetter = ALPHABET[currentIndex];
  const morseCode = MORSE_MAP[currentLetter];

  useEffect(() => () => {
    clearTimeout(autoPlayTimerRef.current);
    clearTimeout(celebrationTimerRef.current);
    clearTimeout(achievementTimerRef.current);
    clearInterval(intensityTimerRef.current);
  }, []);

  useEffect(() => {
    if (mode !== 'learn') clearTimeout(autoPlayTimerRef.current);
  }, [mode]);

  // 离开 learn 模式时暂停视频 —— 切字母/切模式的重新加载交给 <video key={...}> 自动重建
  useEffect(() => {
    if (mode === 'learn') return;
    clearTimeout(autoPlayTimerRef.current);
    const v = videoRef.current;
    if (v) { try { v.pause(); } catch (_) {} }
    setIsPlaying(false);
  }, [mode]);

  // Learn tab 本身被隐藏（切去 Music/Play）时，暂停视频并释放按键音；回来时不自动复播（交给用户点击）
  useEffect(() => {
    if (isActive) return;
    const v = videoRef.current;
    if (v && !v.paused) { try { v.pause(); } catch (_) {} setIsPlaying(false); }
    clearTimeout(autoPlayTimerRef.current);
    // 若正好在按着发报，松开模拟以避免后台持续发声
    if (pressStartRef.current) {
      clearInterval(intensityTimerRef.current);
      try { stopMorseTone(); } catch (_) {}
      pressStartRef.current = null;
      setIsPressing(false);
      setPressIntensity(0);
    }
  }, [isActive]);

  const goTo = (index) => {
    let idx = index;
    if (idx < 0) idx = ALPHABET.length - 1;
    if (idx >= ALPHABET.length) idx = 0;
    clearTimeout(autoPlayTimerRef.current);
    haptic(6);
    setCurrentIndex(idx);
    setIsPlaying(false);
    setIsVideoLoaded(false);
    setTestInput([]);
    setTestResult(null);
    setCelebration(null);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  const handleVideoEnded = () => {
    clearTimeout(autoPlayTimerRef.current);
    setIsPlaying(false);
    autoPlayTimerRef.current = setTimeout(() => {
      setTestInput([]);
      setTestResult(null);
      setCelebration(null);
      if (playModeRef.current === 'loop') {
        // 单字循环：重置并重播当前字母
        const v = videoRef.current;
        if (v) {
          try { v.currentTime = 0; v.play().then(() => setIsPlaying(true)).catch(() => {}); } catch (_) {}
        }
      } else {
        setCurrentIndex((prev) => (prev + 1) % ALPHABET.length);
      }
    }, 3000);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    clearTimeout(autoPlayTimerRef.current);
    haptic(6);
    if (isPlaying) videoRef.current.pause();
    else videoRef.current.play();
    setIsPlaying(!isPlaying);
  };

  const startTest = () => {
    haptic(10);
    if (testSeqMode === 'sequential') {
      setTestLetter(ALPHABET[testSeqIndex]);
      setTestSeqIndex(prev => (prev + 1) % 26);
    } else {
      setTestLetter(ALPHABET[Math.floor(Math.random() * 26)]);
    }
    setTestInput([]);
    setTestResult(null);
    setTestSpeedScore(null);
    setTestQuestionStartTime(Date.now());
  };

  const handlePressIn = useCallback(() => {
    setIsPressing(true);
    pressStartRef.current = Date.now();
    setPressIntensity(0);
    haptic(4);
    startMorseTone();
    let elapsed = 0;
    intensityTimerRef.current = setInterval(() => {
      elapsed += 40;
      // 1200ms 达到满能量，更贴合实际按键节奏
      const intensity = Math.min(elapsed / 1200, 1);
      setPressIntensity(intensity);
      rampMorseTone(intensity);
      if (intensity >= 1) clearInterval(intensityTimerRef.current);
    }, 40);
  }, []);

  const handlePressOut = useCallback(() => {
    if (!pressStartRef.current) { stopMorseTone(); return; }
    clearInterval(intensityTimerRef.current);
    stopMorseTone();
    const duration = Date.now() - pressStartRef.current;
    const type = duration < 250 ? 'dot' : 'dash';
    pressStartRef.current = null;
    setIsPressing(false);
    setPressIntensity(0);
    haptic(type === 'dot' ? 6 : [10, 20, 10]);

    if (mode === 'test') {
      const newInput = [...testInput, type];
      setTestInput(newInput);
      const target = MORSE_MAP[testLetter].split('');
      if (newInput.length === target.length) {
        const isCorrect = newInput.every((v, i) => v === (target[i] === '.' ? 'dot' : 'dash'));
        setTestResult(isCorrect ? 'correct' : 'wrong');
        setTestTotal(prev => prev + 1);

        if (isCorrect) {
          haptic([20, 40, 20]);
          playSuccessChime();
          setTestScore(prev => prev + 1);
          const newStreak = testStreak + 1;
          setTestStreak(newStreak);
          setTestBestStreak(prev => Math.max(prev, newStreak));
          const elapsed = testQuestionStartTime ? (Date.now() - testQuestionStartTime) / 1000 : 10;
          let speedPoints = 0;
          let speedLabel = 'OK';
          if (elapsed < 2) { speedPoints = 50; speedLabel = 'LIGHTNING'; }
          else if (elapsed < 4) { speedPoints = 30; speedLabel = 'FAST'; }
          else if (elapsed < 6) { speedPoints = 20; speedLabel = 'GOOD'; }
          else { speedPoints = 10; speedLabel = 'OK'; }
          setTestSpeedScore(speedPoints);
          const multiplier = Math.min(1 + (newStreak - 1) * 0.5, 3);
          const earnedScore = Math.round(speedPoints * multiplier);
          setTestTotalScore(prev => prev + earnedScore);

          // 飘字 +score
          setFloatPoints({ id: Date.now(), value: earnedScore, label: speedLabel });
          setTimeout(() => setFloatPoints(null), 1400);

          // 连击成就里程碑
          const milestones = { 3: { text: 'NICE COMBO', sub: '×3' }, 5: { text: 'ON FIRE', sub: '×5' }, 10: { text: 'LIGHTNING', sub: '×10' }, 20: { text: 'DIAMOND', sub: '×20' } };
          if (milestones[newStreak]) {
            clearTimeout(achievementTimerRef.current);
            setAchievement({ id: Date.now(), ...milestones[newStreak] });
            playAchievementBell();
            achievementTimerRef.current = setTimeout(() => setAchievement(null), 2200);
          }
        } else {
          haptic([30, 50, 30]);
          playWrongBuzz();
          setTestStreak(0);
          setTestSpeedScore(0);
          setShakeTick(tick => tick + 1);
        }
      }
    } else {
      const targetArr = morseCode.split('').map(c => c === '.' ? 'dot' : 'dash');
      const newInput = [...testInput, type];
      setTestInput(newInput);
      if (newInput.length === targetArr.length) {
        const isCorrect = newInput.every((v, i) => v === targetArr[i]);
        if (isCorrect) {
          const pick = CELEBRATION_SLOGANS[Math.floor(Math.random() * CELEBRATION_SLOGANS.length)];
          setCelebration({ ...pick, id: Date.now() });
          haptic([14, 40, 14]);
          clearTimeout(celebrationTimerRef.current);
          celebrationTimerRef.current = setTimeout(() => setCelebration(null), 2200);
        }
      }
    }
  }, [mode, testLetter, testInput, morseCode, testStreak, testQuestionStartTime]);

  const resetInput = () => {
    haptic(6);
    setTestInput([]);
    setTestResult(null);
    setTestSpeedScore(null);
  };

  const glowOpacity = isPressing ? (0.2 + pressIntensity * 0.8) : 0;
  const glowSize = isPressing ? (120 + pressIntensity * 60) : 0;
  const glowBlur = isPressing ? (30 + pressIntensity * 25) : 0;

  const renderSignals = (signals, size = 'normal') => {
    const dotSize = size === 'large' ? 14 : 10;
    const dashW = size === 'large' ? 40 : 28;
    const dotH = size === 'large' ? 14 : 10;
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {signals.map((sig, i) => (
          <div
            key={i}
            className="rounded-full"
            style={
              sig === 'dot'
                ? { width: dotSize, height: dotH, background: 'var(--gold-100)', boxShadow: '0 0 12px rgba(242,210,122,0.8)' }
                : { width: dashW, height: dotH, background: 'linear-gradient(90deg, var(--gold-600), var(--gold-100))', boxShadow: '0 0 12px rgba(201,162,74,0.6)' }
            }
          />
        ))}
      </div>
    );
  };

  const getStars = () => {
    if (testTotal === 0) return 0;
    const rate = testScore / testTotal;
    if (rate >= 0.9) return 3;
    if (rate >= 0.7) return 2;
    if (rate >= 0.5) return 1;
    return 0;
  };
  const getMultiplier = () => Math.min(1 + (testStreak - 1) * 0.5, 3);

  return (
    <div id="panel-learn" role="tabpanel" className="flex flex-col h-full px-5 fade-up-in">

      {/* Header row */}
      <div className="flex items-center justify-between mt-2 mb-3 flex-shrink-0">
        <span className="text-2xl font-mono" style={{ color: 'var(--text-muted)' }}>
          {mode === 'test' ? (
            <span className="flex items-center gap-2">
              <span className="text-lg">{testScore}<span className="opacity-40">/</span>{testTotal}</span>
              {testStreak >= 2 && (
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full font-sans font-bold flex items-center gap-1"
                  style={{
                    background: 'linear-gradient(135deg, rgba(255,120,60,0.25), rgba(242,210,122,0.3))',
                    color: '#FFD88A',
                    border: '1px solid rgba(255,150,70,0.5)',
                    boxShadow: '0 0 10px rgba(255,140,80,0.35)',
                  }}
                >
                  <Flame className="w-3 h-3" strokeWidth={2.6} /> ×{testStreak}
                </span>
              )}
              <span className="text-lg font-semibold" style={{ color: 'var(--gold-100)' }}>{testTotalScore}</span>
              <span className="text-[10px] font-sans tracking-[0.12em]" style={{ color: 'var(--gold-400)' }}>PTS</span>
            </span>
          ) : (
            <span>{currentIndex + 1} <span className="opacity-50">/</span> 26</span>
          )}
        </span>

        {/* Mode switch */}
        <div
          className="flex items-center p-1 rounded-full"
          style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}
          role="tablist"
          aria-label="模式"
        >
          {[
            { id: 'learn', label: '学习' },
            { id: 'test',  label: '测试' },
          ].map(m => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                role="tab"
                aria-selected={active}
                onClick={(e) => {
                  if (!active) { haptic(6); triggerRipple(e); }
                  setMode(m.id);
                  setTestInput([]);
                  setTestResult(null);
                }}
                className="ripple px-3 h-6 rounded-full text-xs font-medium transition-all duration-300"
                style={active
                  ? { background: 'linear-gradient(135deg, var(--gold-600), var(--gold-400))', color: '#1a1a1a', boxShadow: '0 4px 12px rgba(201,162,74,0.25)' }
                  : { background: 'transparent', color: 'var(--text-muted)' }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {mode === 'learn' && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="上一个字母"
              onClick={() => goTo(currentIndex - 1)}
              className="btn-icon btn-tactile w-8 h-8"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="下一个字母"
              onClick={() => goTo(currentIndex + 1)}
              className="btn-icon btn-tactile w-8 h-8"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
        {mode === 'test' && (
          <button
            type="button"
            onClick={testLetter ? resetInput : startTest}
            className="btn-ghost btn-tactile px-3 h-7 text-xs font-medium"
          >
            {testLetter ? '重置' : '开始'}
          </button>
        )}
      </div>

      {/* ========== Learn mode ========== */}
      {mode === 'learn' && (
        <>
          {/* Video player */}
          <div
            className="w-full rounded-2xl overflow-hidden relative flex-shrink-0"
            style={{ height: '27vh', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}
          >
            <video
              key={currentLetter}
              ref={videoRef}
              src={`/letter/${currentLetter}.mp4`}
              className="w-full h-full"
              playsInline
              muted={!soundOn}
              autoPlay
              preload="auto"
              style={{ objectFit: 'contain', background: 'var(--surface-sunken)' }}
              onLoadedMetadata={() => setIsVideoLoaded(true)}
              onLoadedData={() => setIsVideoLoaded(true)}
              onCanPlay={(e) => {
                setIsVideoLoaded(true);
                // 若期望带声播放但首次没有用户手势被浏览器拦截 → 自动降级为静音继续播，
                // 并把 UI 的喇叭状态切回静音，用户点喇叭即可解锁带声。
                const v = e.currentTarget;
                if (soundOn && v.paused) {
                  const p = v.play();
                  if (p && typeof p.catch === 'function') {
                    p.catch(() => {
                      try {
                        v.muted = true;
                        setSoundOn(false);
                        v.play().catch(() => {});
                      } catch (_) {}
                    });
                  }
                }
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={handleVideoEnded}
              onError={() => setIsVideoLoaded(false)}
              aria-label={`字母 ${currentLetter} 的摩斯教学视频`}
            />
            {!isVideoLoaded && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none"
                style={{ background: 'var(--surface-sunken)' }}
              >
                <div
                  className="text-6xl font-light text-gold-grad"
                  style={{
                    fontFamily: 'var(--font-display)',
                    filter: 'drop-shadow(0 0 20px rgba(242,210,122,0.3))',
                    opacity: 0.6,
                  }}
                >
                  {currentLetter}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--gold-300)', animation: 'dotPulse 1.2s ease-in-out infinite', animationDelay: '0ms' }} />
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--gold-300)', animation: 'dotPulse 1.2s ease-in-out infinite', animationDelay: '180ms' }} />
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--gold-300)', animation: 'dotPulse 1.2s ease-in-out infinite', animationDelay: '360ms' }} />
                </div>
                <style>{`@keyframes dotPulse { 0%,100% { opacity: 0.2; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.15); } }`}</style>
              </div>
            )}
            {/* corner chip */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full glass-chip">
              <span className="live-dot" />
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: 'var(--gold-100)' }}>Morse</span>
            </div>
          </div>

          {/* letter + morse info row */}
          <div className="flex items-center justify-between mt-4 px-1">
            <div className="flex items-center gap-4">
              <span
                className="text-4xl font-light text-gold-grad"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {currentLetter}
              </span>
              {renderSignals(morseCode.split('').map(c => c === '.' ? 'dot' : 'dash'))}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                aria-label={soundOn ? '关闭视频声音' : '开启视频声音'}
                aria-pressed={soundOn}
                onClick={() => {
                  haptic(4);
                  const next = !soundOn;
                  setSoundOn(next);
                  const v = videoRef.current;
                  if (v) {
                    try {
                      v.muted = !next;
                      if (next && v.paused) { v.play().catch(() => {}); }
                    } catch (_) {}
                  }
                }}
                className="btn-icon btn-tactile w-9 h-9"
                style={soundOn ? { color: 'var(--gold-100)', borderColor: 'rgba(201,162,74,0.4)' } : undefined}
              >
                {soundOn ? <Volume2 className="w-[16px] h-[16px]" /> : <VolumeX className="w-[16px] h-[16px]" />}
              </button>
              <button
                type="button"
                aria-label={isPlaying ? '暂停' : '播放'}
                onClick={togglePlay}
                className="btn-primary btn-tactile w-10 h-10 rounded-full flex items-center justify-center"
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-[#1a1a1a]" /> : <Play className="w-4 h-4 fill-[#1a1a1a] ml-0.5" />}
              </button>
            </div>
          </div>

          {/* main key area */}
          <div className="flex-1 flex flex-col items-center justify-center gap-10 relative">
            {celebration && (
              <div
                key={celebration.id}
                className="absolute top-0 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none"
                style={{ top: '-10px', animation: 'celebIn 0.3s ease-out, celebOut 0.5s ease-in 1.6s forwards' }}
              >
                <style>{`
                  @keyframes celebIn {
                    0% { opacity: 0; transform: translateX(-50%) scale(0.5) translateY(20px); }
                    60% { opacity: 1; transform: translateX(-50%) scale(1.08) translateY(-4px); }
                    100% { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
                  }
                  @keyframes celebOut {
                    0% { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
                    100% { opacity: 0; transform: translateX(-50%) scale(0.9) translateY(-24px); }
                  }
                `}</style>
                <div
                  className="flex items-center gap-2 px-6 py-2.5 rounded-2xl"
                  style={{
                    background: 'linear-gradient(135deg, rgba(122,91,31,0.5), rgba(201,162,74,0.42))',
                    border: '1px solid rgba(242,210,122,0.6)',
                    boxShadow: '0 0 40px rgba(242,210,122,0.35), 0 0 80px rgba(242,210,122,0.12)',
                  }}
                >
                  <celebration.icon className="w-5 h-5" style={{ color: 'var(--gold-100)' }} />
                  <span
                    className="text-xl font-semibold tracking-wider"
                    style={{ color: 'var(--gold-100)', filter: 'drop-shadow(0 0 10px rgba(242,210,122,0.8))' }}
                  >
                    {celebration.text}
                  </span>
                </div>
              </div>
            )}

            <div className="text-center">
              <div
                className="min-h-[36px] flex items-center justify-center transition-opacity duration-200"
                style={{ opacity: celebration ? 0 : 1 }}
                aria-hidden={!!celebration}
              >
                {testInput.length > 0 && !celebration && (
                  <div className="flex items-center justify-center gap-3 fade-up-in">
                    {renderSignals(testInput, 'large')}
                    <button
                      type="button"
                      aria-label="清空全部信号"
                      title="清空全部"
                      onClick={() => { haptic(10); setTestInput([]); setCelebration(null); }}
                      className="btn-tactile w-8 h-8 rounded-full flex items-center justify-center transition-all"
                      style={{
                        background: 'rgba(201,162,74,0.08)',
                        border: '1px solid rgba(201,162,74,0.32)',
                        color: 'var(--gold-100)',
                        backdropFilter: 'blur(6px)',
                        WebkitBackdropFilter: 'blur(6px)',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(201,162,74,0.18)';
                        e.currentTarget.style.borderColor = 'rgba(242,210,122,0.55)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(201,162,74,0.08)';
                        e.currentTarget.style.borderColor = 'rgba(201,162,74,0.32)';
                      }}
                    >
                      <X className="w-3.5 h-3.5" strokeWidth={2.4} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <MorseKey
              size={112}
              iconSize={40}
              isPressing={isPressing}
              pressIntensity={pressIntensity}
              glowSize={glowSize}
              glowBlur={glowBlur}
              glowOpacity={glowOpacity}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              Icon={MorseSymbol}
              idleBreathe
            />
          </div>

          {/* 播放模式选择条 —— 仿音乐播放器 */}
          <div className="flex justify-center mb-4 flex-shrink-0">
            <div
              className="inline-flex items-center p-1 rounded-full gap-1"
              style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}
              role="radiogroup"
              aria-label="播放模式"
            >
              {[
                { id: 'sequence', label: '顺序', Icon: ListOrdered, aria: '顺序播放 A 到 Z' },
                { id: 'loop',     label: '单循环', Icon: Repeat1,   aria: '当前字母循环播放' },
              ].map(opt => {
                const active = playMode === opt.id;
                const Icon = opt.Icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={opt.aria}
                    onClick={() => { haptic(6); setPlayMode(opt.id); }}
                    className="btn-tactile flex items-center gap-1.5 h-10 px-4 rounded-full text-[13px] tracking-[0.12em] transition-colors"
                    style={{
                      background: active
                        ? 'linear-gradient(135deg, var(--gold-600), var(--gold-300))'
                        : 'transparent',
                      color: active ? '#1a1a1a' : 'var(--text-muted)',
                      fontWeight: active ? 600 : 500,
                      boxShadow: active ? '0 4px 14px rgba(201,162,74,0.35)' : 'none',
                    }}
                  >
                    <Icon className="w-[15px] h-[15px]" strokeWidth={active ? 2.6 : 2} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ========== Test mode ========== */}
      {mode === 'test' && (
        <>
          {/* 摇晃/爆发动画 keyframes */}
          <style>{`
            @keyframes testShake {
              0%,100% { transform: translateX(0); }
              15% { transform: translateX(-10px) rotate(-1deg); }
              30% { transform: translateX(9px) rotate(1deg); }
              45% { transform: translateX(-7px); }
              60% { transform: translateX(6px); }
              75% { transform: translateX(-3px); }
              90% { transform: translateX(2px); }
            }
            @keyframes testRedFlash {
              0% { box-shadow: 0 0 0 0 rgba(255,107,107,0); background: transparent; }
              15% { box-shadow: inset 0 0 60px rgba(255,107,107,0.25); background: rgba(255,107,107,0.04); }
              100% { box-shadow: 0 0 0 0 rgba(255,107,107,0); background: transparent; }
            }
            @keyframes testBurst {
              0% { opacity: 0; transform: translate(-50%, -30%) scale(0.5); }
              45% { opacity: 1; transform: translate(-50%, -80%) scale(1.15); }
              100% { opacity: 0; transform: translate(-50%, -140%) scale(1); }
            }
            @keyframes testAchieveIn {
              0% { opacity: 0; transform: translate(-50%, 30px) scale(0.8); }
              35% { opacity: 1; transform: translate(-50%, 0) scale(1.06); }
              70% { opacity: 1; transform: translate(-50%, 0) scale(1); }
              100% { opacity: 0; transform: translate(-50%, -16px) scale(0.96); }
            }
            @keyframes morseSlotPulse {
              0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(201,162,74,0); }
              50% { transform: scale(1.18); box-shadow: 0 0 18px rgba(201,162,74,0.6); }
            }
            @keyframes morseSlotPop {
              0% { transform: scale(0.6); opacity: 0.4; }
              55% { transform: scale(1.35); opacity: 1; }
              100% { transform: scale(1); opacity: 1; }
            }
            @keyframes wrongPulse {
              0%,100% { transform: scale(1); background: rgba(255,107,107,0.85) !important; }
              50% { transform: scale(1.3); background: rgba(255,150,150,1) !important; }
            }
          `}</style>

          {/* ========== 空态：进入挑战前 ========== */}
          {!testLetter && (
            <div className="flex-1 flex flex-col items-center justify-center px-2 text-center gap-5">
              <div className="relative flex items-center justify-center">
                <span className="breathe-ring" style={{ width: 260, height: 260 }} />
                <div
                  className="relative w-[180px] h-[180px] rounded-full flex items-center justify-center"
                  style={{
                    background: 'radial-gradient(circle at 30% 25%, rgba(242,210,122,0.28), transparent 70%), var(--surface-sunken)',
                    border: '1px solid rgba(201,162,74,0.35)',
                    boxShadow: '0 18px 56px rgba(201,162,74,0.3), inset 0 2px 0 rgba(255,255,255,0.06)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 112,
                      lineHeight: 1,
                      fontFamily: 'var(--font-display)',
                      color: 'var(--gold-100)',
                      filter: 'drop-shadow(0 0 28px rgba(242,210,122,0.65))',
                    }}
                  >?</span>
                </div>
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-1" style={{ color: 'var(--text)', fontFamily: 'var(--font-display)', letterSpacing: '0.05em' }}>
                  摩斯挑战赛
                </h3>
                <p className="text-[11.5px] tracking-[0.22em] uppercase" style={{ color: 'var(--text-muted)' }}>
                  看字母 · 敲摩斯 · 拼速度与准度
                </p>
              </div>
              {testBestStreak > 0 && (
                <div
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] tracking-[0.18em] uppercase"
                  style={{ background: 'rgba(201,162,74,0.1)', border: '1px solid rgba(201,162,74,0.3)', color: 'var(--gold-100)' }}
                >
                  <Sparkles className="w-3.5 h-3.5" strokeWidth={2.4} />
                  历史最佳连击 × {testBestStreak}
                </div>
              )}
              <button
                type="button"
                onClick={startTest}
                className="btn-primary btn-tactile ripple px-8 h-12 rounded-full text-[14px] tracking-[0.24em] uppercase flex items-center gap-2"
                onMouseDown={triggerRipple}
              >
                <Zap className="w-4 h-4" strokeWidth={2.4} />
                开始挑战
              </button>
              <div className="flex items-center gap-6 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--gold-100)', boxShadow: '0 0 6px var(--gold-100)' }} />
                  短按 · 点
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-5 h-1.5 rounded-full" style={{ background: 'linear-gradient(90deg, var(--gold-600), var(--gold-100))' }} />
                  长按 · 划
                </span>
              </div>
            </div>
          )}

          {/* ========== 答题态 ========== */}
          {testLetter && (() => {
            const targetArr = MORSE_MAP[testLetter].split('');
            const nextIdx = testInput.length; // 待输入位置
            return (
          <>
          <div
            key={`qcard-${shakeTick}-${testLetter}`}
            className="flex-shrink-0 mt-1 relative rounded-3xl"
            style={{
              animation: shakeTick > 0 && testResult === 'wrong'
                ? 'testShake 0.55s cubic-bezier(.36,.07,.19,.97), testRedFlash 0.7s ease-out'
                : undefined,
            }}
          >
            <div className="flex flex-col items-center relative">
              <p className="text-[11px] tracking-[0.24em] uppercase font-medium mb-2" style={{ color: 'var(--gold-400)' }}>
                敲出这个字母的摩斯
              </p>

              {/* 大字母 + 浮字 */}
              <div className="relative mb-3">
                <div
                  className="text-[100px] leading-none font-extralight text-gold-grad"
                  style={{
                    fontFamily: 'var(--font-display)',
                    filter: 'drop-shadow(0 0 30px rgba(242,210,122,0.45))',
                    transform: testResult === 'correct' ? 'scale(1.06)' : 'scale(1)',
                    transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)',
                  }}
                >
                  {testLetter}
                </div>
                {floatPoints && (
                  <div
                    key={floatPoints.id}
                    className="absolute left-1/2 top-1/2 pointer-events-none text-center"
                    style={{
                      animation: 'testBurst 1.3s cubic-bezier(0.22, 1, 0.36, 1) forwards',
                      textShadow: '0 0 22px rgba(242,210,122,0.85)',
                    }}
                  >
                    <div className="text-4xl font-bold" style={{ color: 'var(--gold-100)', fontFamily: 'var(--font-display)' }}>
                      +{floatPoints.value}
                    </div>
                    <div className="text-[10px] tracking-[0.28em] mt-0.5" style={{ color: 'var(--gold-300)' }}>
                      {floatPoints.label}
                    </div>
                  </div>
                )}
              </div>

              {/* Morse 填空遮罩 —— 未输入位全部统一的小圆占位，不泄露答案；
                  用户敲出后才按"自己输入的"形状显示（对：金色；错：红色）。 */}
              <div className="flex items-center justify-center gap-2 mb-3 min-h-[22px]">
                {targetArr.map((ch, i) => {
                  const inputed = testInput[i]; // 'dot' | 'dash' | undefined
                  const targetType = ch === '.' ? 'dot' : 'dash';
                  const matched = inputed && inputed === targetType;
                  const wrong = inputed && inputed !== targetType;
                  const isNext = i === nextIdx && !testResult;

                  let baseStyle;
                  if (!inputed) {
                    baseStyle = { width: 10, height: 10, borderRadius: 999 };
                  } else if (inputed === 'dot') {
                    baseStyle = { width: 14, height: 14, borderRadius: 999 };
                  } else {
                    baseStyle = { width: 36, height: 14, borderRadius: 999 };
                  }

                  let bg = 'transparent';
                  let shadow = 'none';
                  let border = '1px dashed rgba(201,162,74,0.3)';
                  if (matched) {
                    bg = inputed === 'dot' ? 'var(--gold-100)' : 'linear-gradient(90deg, var(--gold-600), var(--gold-100))';
                    shadow = inputed === 'dot' ? '0 0 14px var(--gold-100)' : '0 0 14px rgba(201,162,74,0.7)';
                    border = 'none';
                  } else if (wrong) {
                    bg = 'rgba(255,107,107,0.85)';
                    border = '1px solid rgba(255,107,107,0.9)';
                  } else if (isNext) {
                    border = '1px solid rgba(242,210,122,0.55)';
                  }

                  return (
                    <span
                      key={i}
                      style={{
                        ...baseStyle,
                        background: bg,
                        boxShadow: shadow,
                        display: 'inline-block',
                        border,
                        transition: 'all 0.18s',
                        animation: isNext && !inputed
                          ? 'morseSlotPulse 1.3s ease-in-out infinite'
                          : matched
                            ? 'morseSlotPop 0.35s cubic-bezier(0.34,1.56,0.64,1)'
                            : wrong
                              ? 'wrongPulse 0.45s ease-in-out 2'
                              : undefined,
                      }}
                    />
                  );
                })}
              </div>

              {/* 结果 banner + 连击 / 速度 */}
              <div className="min-h-[34px] flex items-center justify-center gap-3">
                {testResult === 'correct' && testSpeedScore !== null && (
                  <div className="flex items-center gap-2.5 fade-up-in">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3].map(s => (
                        <span key={s} className="text-base" style={{ color: s <= getStars() ? 'var(--gold-100)' : 'rgba(201,162,74,0.2)' }}>★</span>
                      ))}
                    </div>
                    {testStreak > 1 && (
                      <span
                        className="text-[11px] px-2 py-0.5 rounded-full font-semibold tracking-[0.12em]"
                        style={{ background: 'linear-gradient(135deg, rgba(122,91,31,0.5), rgba(201,162,74,0.42))', color: 'var(--gold-100)', border: '1px solid rgba(242,210,122,0.5)' }}
                      >
                        连击 ×{testStreak}
                      </span>
                    )}
                  </div>
                )}
                {testResult === 'wrong' && (
                  <div
                    className="px-4 py-1.5 rounded-full text-[12px] font-semibold flex items-center gap-1.5 fade-up-in"
                    style={{ background: 'rgba(255,107,107,0.12)', color: 'var(--error)', border: '1px solid rgba(255,107,107,0.35)' }}
                  >
                    <X className="w-3.5 h-3.5" />
                    正确答案 {MORSE_MAP[testLetter]}
                  </div>
                )}
              </div>

              {/* 成就横幅 */}
              {achievement && (
                <div
                  key={achievement.id}
                  className="absolute left-1/2 -bottom-2 pointer-events-none flex items-center gap-2 px-5 py-2 rounded-2xl"
                  style={{
                    transform: 'translate(-50%, 100%)',
                    background: 'linear-gradient(135deg, rgba(122,91,31,0.6), rgba(242,210,122,0.55))',
                    border: '1px solid rgba(255,245,215,0.7)',
                    boxShadow: '0 0 40px rgba(242,210,122,0.5), 0 0 80px rgba(242,210,122,0.2)',
                    animation: 'testAchieveIn 2.1s ease-out forwards',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Sparkles className="w-4 h-4" style={{ color: '#1a1a1a' }} strokeWidth={2.6} />
                  <span className="text-[13px] font-bold tracking-[0.18em] uppercase" style={{ color: '#1a1a1a' }}>
                    {achievement.text}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: 'rgba(26,26,26,0.7)' }}>
                    {achievement.sub}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <p className="text-[11px] tracking-[0.24em] uppercase font-medium" style={{ color: 'var(--text-faint)' }}>
              {testInput.length > 0 && !testResult
                ? `${testInput.length} / ${targetArr.length}`
                : testResult === null
                  ? '按住按钮 · 输入信号'
                  : testResult === 'correct' ? '漂亮！下一题' : '别灰心 · 再试一次'}
            </p>

            <MorseKey
              size={128}
              iconSize={48}
              isPressing={isPressing}
              pressIntensity={pressIntensity}
              glowSize={glowSize}
              glowBlur={glowBlur}
              glowOpacity={glowOpacity}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              Icon={MorseSymbol}
              idleBreathe={!testLetter || testResult === null}
            />
          </div>
          </>
            );
          })()}

          {/* bottom actions — 仅在已进入挑战时显示 */}
          {testLetter && (
            <div className="flex items-center justify-center gap-3 mb-4 flex-shrink-0">
              <button
                type="button"
                aria-label="删除最后一个信号"
                onClick={() => {
                  if (testInput.length > 0) {
                    haptic(4);
                    setTestInput(prev => prev.slice(0, -1));
                    setTestResult(null);
                    setTestSpeedScore(null);
                  }
                }}
                disabled={testInput.length === 0 || testResult !== null}
                className="btn-icon btn-tactile w-14 h-14 rounded-2xl flex flex-col items-center justify-center gap-0.5"
                style={{ opacity: (testInput.length === 0 || testResult !== null) ? 0.4 : 1 }}
              >
                <Delete className="w-5 h-5" />
                <span className="text-[10px] tracking-wider">删除</span>
              </button>

              {testResult === 'wrong' && (
                <button
                  type="button"
                  onClick={() => { haptic(6); setTestInput([]); setTestResult(null); setTestSpeedScore(null); setTestQuestionStartTime(Date.now()); }}
                  className="btn-tactile px-5 h-14 rounded-2xl flex items-center gap-2 font-semibold"
                  style={{
                    background: 'rgba(201,162,74,0.12)',
                    border: '1px solid rgba(201,162,74,0.4)',
                    color: 'var(--gold-100)',
                    fontSize: 13,
                  }}
                >
                  <Repeat className="w-4 h-4" strokeWidth={2.4} />
                  再试一次
                </button>
              )}

              <button
                type="button"
                onClick={() => { haptic(8); startTest(); }}
                className="btn-primary btn-tactile ripple"
                onMouseDown={triggerRipple}
                style={{
                  padding: '0 22px',
                  height: 56,
                  borderRadius: 18,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 6, fontWeight: 600, fontSize: 15,
                }}
              >
                <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
                {testResult === null ? '跳过' : '下一题'}
              </button>

              <button
                type="button"
                aria-label={testSeqMode === 'sequential' ? '切换为随机出题' : '切换为顺序出题'}
                onClick={() => { haptic(6); setTestSeqMode(prev => prev === 'random' ? 'sequential' : 'random'); }}
                className="btn-tactile w-14 h-14 rounded-2xl flex flex-col items-center justify-center gap-0.5 transition-all"
                style={{
                  background: testSeqMode === 'sequential' ? 'rgba(201,162,74,0.12)' : 'var(--surface-sunken)',
                  border: `1px solid ${testSeqMode === 'sequential' ? 'rgba(201,162,74,0.4)' : 'var(--border-subtle)'}`,
                  color: testSeqMode === 'sequential' ? 'var(--gold-100)' : 'var(--text-muted)',
                }}
              >
                {testSeqMode === 'random'
                  ? <><Shuffle className="w-4 h-4" /><span className="text-[10px] tracking-wider">随机</span></>
                  : <><List className="w-4 h-4" /><span className="text-[10px] tracking-wider">顺序</span></>}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/* 摩斯码图标：一个点 + 一个划，仿 lucide 接口，接收 style 控制尺寸与颜色 */
const MorseSymbol = ({ style, className }) => (
  <svg
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ ...style, fill: 'currentColor' }}
    aria-hidden="true"
  >
    <circle cx="5.6" cy="12" r="2.8" fill="currentColor" />
    <rect x="10.6" y="9" width="11" height="6" rx="3" fill="currentColor" />
  </svg>
);

/* ===== 长按蓄力闪电环 —— 仅在 pressIntensity > 阈值时渲染 ===== */
const LightningArc = ({ size, intensity }) => {
  if (intensity <= 0) return null;
  const bolts = [0, 60, 120, 180, 240, 300];
  const cx = size;
  const cy = size;
  const innerR = size * 0.55;
  const outerR = size * 0.55 + size * (0.18 + intensity * 0.22);
  const visibleBolts = Math.max(2, Math.floor(2 + intensity * 6));
  return (
    <svg
      width={size * 2}
      height={size * 2}
      className="absolute top-1/2 left-1/2 pointer-events-none"
      style={{ transform: 'translate(-50%, -50%)', overflow: 'visible' }}
      aria-hidden="true"
    >
      {bolts.slice(0, visibleBolts).map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const startX = cx + Math.cos(rad) * innerR;
        const startY = cy + Math.sin(rad) * innerR;
        const endX = cx + Math.cos(rad) * outerR;
        const endY = cy + Math.sin(rad) * outerR;
        const normalX = -Math.sin(rad);
        const normalY = Math.cos(rad);
        const segs = 5;
        const pts = [`M ${startX} ${startY}`];
        for (let s = 1; s < segs; s++) {
          const t = s / segs;
          const bx = startX + (endX - startX) * t;
          const by = startY + (endY - startY) * t;
          // 用 deg + s 做确定性伪随机，避免每次 render 完全乱跳
          const seed = Math.sin(deg * 17.3 + s * 41.7) * 43758.5453;
          const jitter = (seed - Math.floor(seed) - 0.5) * size * 0.08;
          pts.push(`L ${bx + normalX * jitter} ${by + normalY * jitter}`);
        }
        pts.push(`L ${endX} ${endY}`);
        return (
          <path
            key={deg}
            d={pts.join(' ')}
            stroke="rgba(255,248,220,0.95)"
            strokeWidth={1.6}
            strokeLinecap="round"
            fill="none"
            style={{
              filter: 'drop-shadow(0 0 6px rgba(242,210,122,1)) drop-shadow(0 0 14px rgba(242,210,122,0.6))',
              // 刚触发就足够亮（0.15 阈值起 50%，0.55 即满），避免"刚出来几乎看不见"
              opacity: Math.min(1, 0.5 + (intensity - 0.15) * 1.25),
              animation: `lightningFlicker 0.12s steps(2) infinite`,
              animationDelay: `${i * 0.025}s`,
            }}
          />
        );
      })}
    </svg>
  );
};

/* Main morse-key button — used in both learn & test modes. */
const MorseKey = ({ size, iconSize, isPressing, pressIntensity = 0, glowSize, glowBlur, glowOpacity, onPressIn, onPressOut, Icon, idleBreathe }) => {
  // 分段阈值 —— 仅用于额外视觉效果（音频/手势逻辑不变）
  // 阈值都已前移：按住 ~200ms 就能看到闪电，~450ms 起充能脉冲，~750ms 核心过亮，1200ms 满能量
  const showLightning = isPressing && pressIntensity > 0.15;
  const pulseStage = isPressing && pressIntensity > 0.35;
  const whiteCore = isPressing && pressIntensity > 0.6;
  const surfaceHue = Math.min(pressIntensity, 1);                   // 表面渐变白度
  const ringLen = Math.PI * 2 * (size / 2 + 12);

  return (
    <div className="flex justify-center relative">
      {/* 内联 keyframes —— 仅限按键内用到的几条动画 */}
      <style>{`
        @keyframes lightningFlicker {
          0%,100% { opacity: 1; }
          50% { opacity: 0.28; }
        }
        @keyframes chargeRing {
          0% { opacity: 0.7; transform: translate(-50%, -50%) scale(0.82); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.45); }
        }
        @keyframes energyBreathe {
          0%,100% { filter: brightness(1); }
          50% { filter: brightness(1.12); }
        }
      `}</style>

      {/* ========== 外围 radial glow (原有三层) ========== */}
      <div
        className="absolute top-1/2 left-1/2 pointer-events-none rounded-full transition-all duration-100"
        style={{
          width: glowSize + 60, height: glowSize + 60,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, rgba(242,210,122,${glowOpacity * 0.3}) 0%, rgba(201,162,74,${glowOpacity * 0.5}) 40%, transparent 70%)`,
          filter: `blur(${glowBlur + 20}px)`,
        }}
      />
      <div
        className="absolute top-1/2 left-1/2 pointer-events-none rounded-full transition-all duration-100"
        style={{
          width: glowSize + 20, height: glowSize + 20,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, rgba(242,210,122,${glowOpacity * 0.6}) 0%, rgba(201,162,74,${glowOpacity * 0.8}) 50%, transparent 70%)`,
          filter: `blur(${glowBlur}px)`,
        }}
      />
      <div
        className="absolute top-1/2 left-1/2 pointer-events-none rounded-full transition-all duration-100"
        style={{
          width: glowSize, height: glowSize,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, rgba(255,255,255,${glowOpacity * 0.4}) 0%, rgba(242,210,122,${glowOpacity * 0.9}) 30%, transparent 70%)`,
          filter: `blur(${glowBlur * 0.6}px)`,
        }}
      />

      {/* ========== 闪电弧 ========== */}
      {showLightning && <LightningArc size={size + 30} intensity={pressIntensity} />}

      {/* ========== 充能脉冲环（向外扩散） ========== */}
      {pulseStage && (
        <>
          <div
            className="absolute top-1/2 left-1/2 pointer-events-none rounded-full"
            style={{
              width: size + 16, height: size + 16,
              border: '2px solid rgba(242,210,122,0.7)',
              boxShadow: '0 0 24px rgba(242,210,122,0.5)',
              animation: 'chargeRing 0.7s ease-out infinite',
            }}
          />
          <div
            className="absolute top-1/2 left-1/2 pointer-events-none rounded-full"
            style={{
              width: size + 16, height: size + 16,
              border: '1.5px solid rgba(255,245,215,0.55)',
              animation: 'chargeRing 0.7s ease-out infinite',
              animationDelay: '0.35s',
            }}
          />
        </>
      )}

      {/* ========== 进度环（SVG circle，顺着按钮边缘转圈） ========== */}
      {isPressing && (
        <svg
          width={size + 28}
          height={size + 28}
          className="absolute top-1/2 left-1/2 pointer-events-none"
          style={{ transform: 'translate(-50%, -50%) rotate(-90deg)' }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#F2D27A" />
              <stop offset="55%" stopColor="#FFF5D7" />
              <stop offset="100%" stopColor="#C9A24A" />
            </linearGradient>
          </defs>
          <circle
            cx={(size + 28) / 2}
            cy={(size + 28) / 2}
            r={(size + 28) / 2 - 4}
            fill="none"
            stroke="rgba(242,210,122,0.12)"
            strokeWidth={2.5}
          />
          <circle
            cx={(size + 28) / 2}
            cy={(size + 28) / 2}
            r={(size + 28) / 2 - 4}
            fill="none"
            stroke="url(#ringGrad)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={ringLen}
            strokeDashoffset={(1 - pressIntensity) * ringLen}
            style={{
              filter: 'drop-shadow(0 0 6px rgba(242,210,122,0.85))',
              transition: 'stroke-dashoffset 60ms linear',
            }}
          />
        </svg>
      )}

      <button
        type="button"
        aria-label="按住发送摩斯信号"
        onMouseDown={onPressIn}
        onMouseUp={onPressOut}
        onMouseLeave={() => isPressing && onPressOut()}
        onTouchStart={(e) => { e.preventDefault(); onPressIn(); }}
        onTouchEnd={(e) => { e.preventDefault(); onPressOut(); }}
        onContextMenu={(e) => e.preventDefault()}
        className="relative z-10 rounded-full flex items-center justify-center transition-all duration-150"
        style={{
          width: size, height: size,
          ...(isPressing
            ? {
                // 表面随充能从暖金渐亮到近白金；白核心在高强度时叠一层径向亮斑
                background: whiteCore
                  ? `radial-gradient(circle at 50% 40%, #FFFBEB ${10 + surfaceHue * 35}%, #F2D27A 55%, #C9A24A 100%)`
                  : `linear-gradient(135deg, #F2D27A, #C9A24A)`,
                transform: 'scale(0.94)',
                boxShadow: `inset 0 8px 20px rgba(0,0,0,0.22), 0 0 0 2px rgba(255,245,215,${0.25 + surfaceHue * 0.4}), 0 0 ${24 + surfaceHue * 32}px rgba(242,210,122,${0.25 + surfaceHue * 0.4})`,
                animation: pulseStage ? 'energyBreathe 0.55s ease-in-out infinite' : undefined,
              }
            : {
                background: 'linear-gradient(135deg, #7A5B1F 0%, #C9A24A 50%, #F2D27A 100%)',
                boxShadow: '0 14px 40px rgba(201,162,74,0.35), inset 0 2px 0 rgba(255,255,255,0.25), inset 0 -6px 14px rgba(0,0,0,0.18)',
                transform: 'scale(1)',
              }),
        }}
      >
        {idleBreathe && !isPressing && <span className="breathe-ring" />}
        <div
          className="rounded-full flex items-center justify-center"
          style={{
            width: size - 14, height: size - 14,
            background: isPressing ? 'rgba(0,0,0,0.06)' : 'transparent',
            border: `2px solid rgba(0,0,0,${0.15 - surfaceHue * 0.08})`,
          }}
        >
          <Icon
            style={{
              width: iconSize, height: iconSize,
              color: isPressing ? '#1A1A1A' : 'rgba(26,26,26,0.85)',
              fill: isPressing ? '#1A1A1A' : 'none',
              strokeWidth: 2.2,
            }}
          />
        </div>
      </button>
    </div>
  );
};

/* =========================================================
   MusicScreen — 声印生成
   ========================================================= */
const MusicScreen = ({ isActive = true }) => {
  const [word, setWord] = useState('');
  const [styles, setStyles] = useState([]);
  const [selectedStyle, setSelectedStyle] = useState('healing');
  const [withVocals, setWithVocals] = useState(false);
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState('');
  const [result, setResult] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [introMs, setIntroMs] = useState(0);
  const [displayPhrase, setDisplayPhrase] = useState(null);
  const [dotEffect, setDotEffect] = useState(null);
  const [dashEffect, setDashEffect] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLetterIdx, setCurrentLetterIdx] = useState(-1);
  const [currentMorse, setCurrentMorse] = useState('');
  const [morseSig, setMorseSig] = useState(null);
  // 当前 timeline 项的 per-letter effect；比整曲默认 dotEffect/dashEffect 优先
  const [curDotEff, setCurDotEff] = useState(null);
  const [curDashEff, setCurDashEff] = useState(null);

  const audioRef = useRef(null);
  const rafRef = useRef(null);
  const isSeekingRef = useRef(false);

  useEffect(() => {
    fetch(apiUrl('/api/styles'))
      .then(r => r.json())
      .then(data => setStyles(data.styles || []))
      .catch(() => {});
  }, []);

  const startTicker = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);
  const stopTicker = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);
  useEffect(() => () => stopTicker(), [stopTicker]);

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    haptic(6);
    if (isPlaying) audioRef.current.pause();
    else {
      audioRef.current.play().catch(() => {});
      startTicker();
    }
    setIsPlaying(!isPlaying);
  };

  const handleAudioTimeUpdate = () => {
    if (!audioRef.current || !result) return;
    const ms = audioRef.current.currentTime * 1000;
    const im = result.intro_duration_ms || 0;
    if (ms > im + 200) {
      setIsPlaying(false);
      stopTicker();
    }
    if (timeline.length === 0) return;
    let idx = -1;
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (ms >= timeline[i].start_ms) { idx = i; break; }
    }
    setCurrentLetterIdx(idx);
    if (idx >= 0) {
      const cur = timeline[idx];
      const morse = cur.morse_pretty || cur.morse || '';
      const deff = cur.dot_effect || dotEffect || 'bloom';
      const deff2 = cur.dash_effect || dashEffect || 'bloom';
      const sig = idx + ':' + morse + ':' + deff + ':' + deff2;
      if (sig !== morseSig) {
        setMorseSig(sig);
        setCurrentMorse(morse);
        setCurDotEff(deff);
        setCurDashEff(deff2);
      }
    } else if (timeline.length > 0 && morseSig?.startsWith('init:')) {
      // keep
    } else if (timeline.length > 0) {
      const first0 = timeline[0];
      const m0 = first0.morse_pretty || first0.morse || '';
      const deff = first0.dot_effect || dotEffect || 'bloom';
      const deff2 = first0.dash_effect || dashEffect || 'bloom';
      const sig0 = 'init:' + m0 + ':' + deff + ':' + deff2;
      if (sig0 !== morseSig) {
        setMorseSig(sig0);
        setCurrentMorse(m0);
        setCurDotEff(deff);
        setCurDashEff(deff2);
      }
    }
  };

  const handleAudioEnded = () => { setIsPlaying(false); stopTicker(); };
  const handleAudioLoaded = () => { if (audioRef.current) setDuration(audioRef.current.duration); };

  const loadDemo = () => {
    if (isGenerating) return;
    haptic(6);
    setIsGenerating(true);
    setStatus('加载示例中'); setStatusKind('loading');
    fetch(apiUrl('/api/demo'))
      .then(r => r.json())
      .then(data => { renderResult(data); setIsGenerating(false); setStatus(''); setStatusKind(''); })
      .catch(() => { setStatus('示例加载失败'); setStatusKind('err'); setIsGenerating(false); });
  };

  const handleGenerate = () => {
    if (!word.trim()) { setStatus('请先输入单词'); setStatusKind('err'); return; }
    if (isGenerating) return;
    haptic(10);
    setIsGenerating(true);
    setStatus('正在为你谱曲'); setStatusKind('loading');
    setResult(null);
    stopTicker();
    setCurrentTime(0);
    setCurrentLetterIdx(-1);
    setCurrentMorse('');
    setMorseSig(null);
    setCurDotEff(null);
    setCurDashEff(null);
    setIsPlaying(false);

    fetch(apiUrl('/api/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: word.trim(), style: selectedStyle, with_vocals: withVocals }),
    })
      .then(r => r.json().catch(() => ({})))
      .then(data => {
        if (!data.audio_url) throw new Error(data.detail || '生成失败');
        renderResult(data);
        setIsGenerating(false); setStatus(''); setStatusKind('');
      })
      .catch(e => {
        let msg = '暂时没能生成，请稍后再试';
        const raw = String(e.message || '');
        if (/仅支持英文字母|仅字母|A-Z|长度/.test(raw)) msg = '请输入 1–10 个英文字母（A–Z）';
        else if (/填写单词|word/i.test(raw)) msg = '请先输入你的词';
        else if (/限流|1002/.test(raw)) msg = '用的人有点多，稍后再试';
        else if (/余额|1008/.test(raw)) msg = '服务暂时不可用';
        else if (/敏感|违规|1026/.test(raw)) msg = '换一个词试试吧';
        setStatus(msg); setStatusKind('err'); setIsGenerating(false);
      });
  };

  const renderResult = (data) => {
    setResult(data);
    setTimeline(data.letter_timeline || []);
    setIntroMs(data.intro_duration_ms || 0);
    setDisplayPhrase(data.display_phrase || null);
    setDotEffect(data.dot_effect || null);
    setDashEffect(data.dash_effect || null);

    const rawUrl = data.audio_url;
    const url = rawUrl.startsWith('http')
      ? rawUrl
      : apiUrl(rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`);
    const finalUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    if (audioRef.current) {
      audioRef.current.src = finalUrl;
      audioRef.current.load();
    }
    if (data.letter_timeline?.length && data.intro_duration_ms > 0) {
      const first0 = data.letter_timeline[0];
      const m0 = first0.morse_pretty || first0.morse || '';
      const deff = first0.dot_effect || data.dot_effect || 'bloom';
      const deff2 = first0.dash_effect || data.dash_effect || 'bloom';
      setMorseSig('init:' + m0 + ':' + deff + ':' + deff2);
      setCurrentMorse(m0);
      setCurDotEff(deff);
      setCurDashEff(deff2);
    }
  };

  const selectedStyleLabel = styles.find(s => s.id === selectedStyle)?.label || '—';

  const fmt = (ms) => Math.max(0, ms / 1000).toFixed(1) + 's';
  const fmtAudio = (s) => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + sec.toString().padStart(2, '0');
  };

  const progressRatio = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const introRatio = introMs > 0 ? Math.min(currentTime * 1000 / introMs, 1) : 0;

  const MORSE_EFFECT_STAGGER = { bloom: 95, hit: 220, crisp: 60, pixel: 80, pluck: 140 };
  const pickEffect = (ch, deff, deff2) => {
    if (ch === '·' || ch === '.') return deff || 'bloom';
    if (ch === '−' || ch === '-') return deff2 || 'bloom';
    return 'bloom';
  };
  const buildMorseSpans = () => {
    if (!currentMorse) return null;
    let delay = 0;
    // 优先用当前 timeline 项的 per-letter effect；回退到整曲默认、再回退到 bloom
    const dotEff = curDotEff || dotEffect;
    const dashEff = curDashEff || dashEffect;
    return currentMorse.split('').map((ch, i) => {
      const eff = pickEffect(ch, dotEff, dashEff);
      const d = delay;
      delay += MORSE_EFFECT_STAGGER[eff] || 95;
      return { ch, eff, delay: d, key: i };
    });
  };
  const morseSpans = buildMorseSpans();
  const letters = result?.word?.toUpperCase()?.split('') || [];

  // 词组模式（如 demo 的 "Mission: Impossible"）：短语斜体小字 + 首字母放大 + 按 hero_idx 高亮
  const isPhraseMode = !!displayPhrase;
  // 示例曲用电影原声海报；用户生成曲用 Morsomatic 唱片插画（与 /api/demo 返回的 demo 字段对齐）
  const albumArtSrc = result?.demo ? '/img/mission-impossible-poster.png' : '/img/album-cover.png';
  const albumArtAlt = result?.demo ? 'Mission: Impossible 电影原声封面' : '声印 · 唱片封面';
  const phraseChars = isPhraseMode ? displayPhrase.split('') : [];
  const heroSet = isPhraseMode
    ? new Set((timeline || []).map((iv) => iv.hero_idx).filter((x) => typeof x === 'number'))
    : null;
  let currentHeroIdx = -1;
  let playedHeroSet = null;
  if (isPhraseMode && currentLetterIdx >= 0) {
    playedHeroSet = new Set();
    for (let i = 0; i <= currentLetterIdx; i++) {
      const hi = timeline[i]?.hero_idx;
      if (typeof hi === 'number') playedHeroSet.add(hi);
    }
    const curHi = timeline[currentLetterIdx]?.hero_idx;
    if (typeof curHi === 'number') {
      currentHeroIdx = curHi;
      playedHeroSet.delete(curHi);
    }
  }

  const resetToEdit = () => {
    haptic(6);
    setResult(null);
    setTimeline([]);
    setDisplayPhrase(null);
    setStatus(null);
    setStatusKind(null);
    setCurrentLetterIdx(-1);
    setCurrentMorse('');
    setMorseSig(null);
    setCurDotEff(null);
    setCurDashEff(null);
    setIsPlaying(false);
    if (audioRef.current) { try { audioRef.current.pause(); } catch (_) {} audioRef.current.src = ''; }
  };

  return (
    <div id="panel-music" role="tabpanel" className="flex flex-col h-full px-5 fade-up-in pb-4">
      {/* header — 单行超紧凑：未生成用 slogan，已生成用作品名 */}
      <div className="mt-1 mb-2.5 flex items-center justify-between flex-shrink-0 gap-2">
        {result ? (
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: 'var(--gold-100)', boxShadow: '0 0 8px var(--gold-100)', animation: 'pulse 1.6s ease-in-out infinite' }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p
                className="text-[14px] leading-tight truncate"
                style={{ color: 'var(--gold-100)', fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}
              >
                <strong>{(displayPhrase || result.word || '').toUpperCase()}</strong>
              </p>
              <p
                className="text-[10px] tracking-[0.16em] uppercase truncate leading-tight mt-0.5"
                style={{ color: 'var(--text-muted)' }}
              >
                {result.style_label}
              </p>
            </div>
          </div>
        ) : (
          // 编辑态极简品牌角：一个点 + 一个划 + "声印"字样，去掉生硬 slogan
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            <span
              className="inline-block rounded-full flex-shrink-0"
              style={{ width: 5, height: 5, background: 'var(--gold-100)', boxShadow: '0 0 5px rgba(242,210,122,0.55)' }}
              aria-hidden="true"
            />
            <span
              className="inline-block rounded-full flex-shrink-0"
              style={{ width: 14, height: 5, background: 'linear-gradient(90deg, var(--gold-600), var(--gold-100))' }}
              aria-hidden="true"
            />
            <span
              className="text-[13px] ml-1 font-semibold flex-shrink-0"
              style={{ color: 'var(--gold-100)', fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}
            >
              声印
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {result && (
            <button
              type="button"
              onClick={resetToEdit}
              aria-label="再谱一曲 · 创作你的专属歌曲"
              title="再谱一曲"
              className="btn-ghost btn-tactile px-3 h-8 text-[11px] tracking-[0.18em] flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" strokeWidth={2.2} style={{ color: 'var(--gold-100)' }} />
              <span style={{ color: 'var(--gold-100)', fontFamily: 'var(--font-display)', letterSpacing: '0.12em' }}>
                再谱一曲
              </span>
            </button>
          )}
          <button type="button" aria-label="分享" className="btn-icon btn-tactile w-8 h-8">
            <Share2 className="w-[15px] h-[15px]" />
          </button>
        </div>
      </div>

      {/* scrollable content */}
      <div className="flex-1 overflow-y-auto space-y-2.5 flex-shrink-0 pr-1" style={{ maxHeight: 'calc(100vh - 180px)' }}>

        {/* 表单：仅在未出结果时展示 */}
        {!result && (
        <>
        {/* Demo card */}
        <div
          className="w-full rounded-2xl px-3 py-2 flex items-center justify-between gap-2"
          style={{ background: 'rgba(201,162,74,0.04)', border: '1px dashed rgba(201,162,74,0.3)' }}
        >
          <div className="min-w-0">
            <p className="text-[12.5px] leading-tight" style={{ color: 'var(--text)' }}>
              听过 <strong style={{ color: 'var(--gold-100)' }}>碟中谍</strong> 主题曲吗？
            </p>
            <p className="text-[10.5px] mt-0.5 leading-tight" style={{ color: 'var(--text-muted)' }}>
              前奏里，藏着 M（−−）I（··）
            </p>
          </div>
          <button
            type="button"
            onClick={loadDemo}
            disabled={isGenerating}
            aria-disabled={isGenerating}
            className="btn-ghost btn-tactile px-2.5 h-7 text-[10.5px] font-medium tracking-[0.2em] uppercase flex-shrink-0"
            style={{ opacity: isGenerating ? 0.45 : 1 }}
          >
            先听示例
          </button>
        </div>

        {/* Word input */}
        <div>
          <label className="text-[9.5px] block mb-1 tracking-[0.24em] uppercase font-medium" style={{ color: 'var(--text-muted)' }}>
            你的词
          </label>
          <input
            type="text"
            value={word}
            onChange={e => setWord(e.target.value)}
            placeholder="例如 Lucas / love / home"
            maxLength={10}
            autoComplete="off"
            className="w-full px-3.5 py-2 rounded-2xl text-[14px] transition-colors"
            style={{
              background: 'var(--surface-sunken)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text)',
            }}
            onFocus={e => {
              e.target.style.borderColor = 'rgba(201,162,74,0.5)';
              e.target.style.boxShadow = '0 0 0 3px rgba(201,162,74,0.12)';
            }}
            onBlur={e => {
              e.target.style.borderColor = 'var(--border-subtle)';
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>

        {/* Style picker */}
        <div>
          <label className="text-[9.5px] block mb-1 tracking-[0.24em] uppercase font-medium" style={{ color: 'var(--text-muted)' }}>
            选择风格
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => { haptic(4); setStylePanelOpen(!stylePanelOpen); }}
              aria-expanded={stylePanelOpen}
              aria-haspopup="listbox"
              className="w-full flex items-center justify-between px-3.5 py-2 rounded-2xl text-[14px] transition-all"
              style={{
                background: 'var(--surface-sunken)',
                border: `1px solid ${stylePanelOpen ? 'rgba(201,162,74,0.45)' : 'var(--border-subtle)'}`,
                boxShadow: stylePanelOpen ? '0 0 0 3px rgba(201,162,74,0.12)' : 'none',
                color: 'var(--text)',
              }}
            >
              <span>{selectedStyleLabel}</span>
              <span
                className="w-2 h-2 border-r-2 border-b-2 transition-transform"
                style={{
                  borderColor: 'var(--gold-400)',
                  transform: stylePanelOpen ? 'rotate(-135deg)' : 'rotate(45deg)',
                  marginBottom: -2,
                }}
              />
            </button>
            {stylePanelOpen && (
              <div
                className="absolute left-0 right-0 top-full mt-2 p-3 rounded-2xl z-50 fade-up-in"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: '0 20px 44px rgba(0,0,0,0.55)',
                }}
                role="listbox"
              >
                <div className="grid grid-cols-3 gap-2">
                  {styles.map(s => {
                    const active = s.id === selectedStyle;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => { haptic(4); setSelectedStyle(s.id); setStylePanelOpen(false); }}
                        className="btn-tactile py-2.5 px-2 rounded-full text-sm text-center transition-all"
                        style={{
                          background: active ? 'rgba(201,162,74,0.14)' : 'var(--surface-sunken)',
                          color: active ? 'var(--gold-100)' : 'var(--text-muted)',
                          border: `1px solid ${active ? 'rgba(201,162,74,0.45)' : 'var(--border-subtle)'}`,
                        }}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Vocals toggle */}
        <div
          className="flex items-center justify-between px-3.5 py-2 rounded-2xl"
          style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}
        >
          <div>
            <p className="text-[13.5px] leading-tight" style={{ color: 'var(--text)' }}>加入人声演唱</p>
            <p className="text-[10.5px] mt-0.5 leading-tight" style={{ color: 'var(--text-muted)' }}>关闭则生成纯器乐版本</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={withVocals}
            aria-label="加入人声演唱"
            onClick={() => { haptic(4); setWithVocals(!withVocals); }}
            className="w-11 h-6 rounded-full relative transition-all flex-shrink-0"
            style={{
              background: withVocals ? 'linear-gradient(135deg, var(--gold-600), var(--gold-300))' : '#1a1a22',
              border: `1px solid ${withVocals ? 'rgba(201,162,74,0.55)' : 'var(--border-subtle)'}`,
            }}
          >
            <span
              className="absolute top-1/2 w-4 h-4 rounded-full transition-all duration-300"
              style={{
                transform: 'translateY(-50%)',
                left: withVocals ? '22px' : '3px',
                background: withVocals ? '#fff7df' : '#5a5867',
                boxShadow: withVocals ? '0 0 10px rgba(242,210,122,0.7)' : 'none',
              }}
            />
          </button>
        </div>

        {/* Generate CTA */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          aria-disabled={isGenerating}
          className="btn-primary btn-tactile ripple w-full py-2.5 rounded-full text-[14px] tracking-[0.22em] uppercase flex items-center justify-center gap-2"
          onMouseDown={triggerRipple}
          style={{ opacity: isGenerating ? 0.75 : 1 }}
        >
          {isGenerating ? (
            <>
              <span
                className="inline-block w-3 h-3 rounded-full border-2"
                style={{ borderColor: 'rgba(26,26,26,0.35)', borderTopColor: '#1a1a1a', animation: 'spin 0.8s linear infinite' }}
              />
              <span>生成中…</span>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" strokeWidth={2.4} />
              <span>生成我的歌</span>
            </>
          )}
        </button>

        {/* Status */}
        {status && (
          <p
            className="text-center text-sm flex items-center justify-center gap-1.5"
            style={{ color: statusKind === 'err' ? '#ff8080' : 'var(--gold-100)', opacity: statusKind === 'loading' ? 0.9 : 1 }}
            role="status"
            aria-live="polite"
          >
            <span>{status}</span>
            {statusKind === 'loading' && (
              <span className="inline-block w-1 h-1 rounded-full" style={{ background: 'var(--gold-100)', animation: 'pulse 1.2s ease-in-out infinite' }} />
            )}
          </p>
        )}
        </>
        )}

        {/* Result card */}
        {result && (
          <div
            className="rounded-[24px] overflow-hidden fade-up-in"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)', boxShadow: '0 8px 40px rgba(0,0,0,0.4)' }}
          >
            <div
              className="w-full h-7 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(201,162,74,0.12) 0%, transparent 70%)' }}
            />
            <div className="px-4 pb-4 -mt-1">
              {/* ========== 唱片封面 Album Cover —— 居中大图，纯视觉，无冗余文字 ========== */}
              <div className="flex justify-center mb-4 mt-1">
                <div
                  className="relative w-[132px] h-[132px] rounded-2xl overflow-hidden"
                  style={{
                    border: '1px solid rgba(201,162,74,0.45)',
                    boxShadow: '0 12px 32px rgba(0,0,0,0.6), 0 0 36px rgba(201,162,74,0.22)',
                    background: 'rgba(255,255,255,0.04)',
                  }}
                >
                  <img
                    src={albumArtSrc}
                    alt={albumArtAlt}
                    className="w-full h-full object-cover"
                    style={{ transition: 'transform 0.6s ease', transform: isPlaying ? 'scale(1.05)' : 'scale(1)' }}
                    draggable={false}
                  />
                  {/* 高光反射 */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, transparent 45%)' }}
                  />
                  {/* 底部暗角，让封面更立体 */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: 'radial-gradient(ellipse at 50% 115%, rgba(0,0,0,0.5) 0%, transparent 55%)' }}
                  />
                  {/* Now Playing 指示灯 */}
                  {isPlaying && (
                    <span
                      className="absolute bottom-2 right-2 inline-flex items-center justify-center"
                      style={{
                        width: 16, height: 16,
                        borderRadius: 999,
                        background: 'rgba(10,10,10,0.65)',
                        backdropFilter: 'blur(4px)',
                        border: '1px solid rgba(242,210,122,0.6)',
                      }}
                      aria-hidden="true"
                    >
                      <span
                        style={{
                          width: 7, height: 7, borderRadius: 999,
                          background: 'var(--gold-100)',
                          boxShadow: '0 0 8px rgba(242,210,122,0.95)',
                          animation: 'pulse 1.4s ease-in-out infinite',
                        }}
                      />
                    </span>
                  )}
                </div>
              </div>

              {/* intro zone */}
              <div className="transition-opacity" style={{ opacity: currentTime * 1000 > introMs + 200 ? 0.45 : 1 }}>
                <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] mb-2" style={{ color: 'var(--text-muted)' }}>
                  <span className="flex items-center gap-1.5">
                    <span className="live-dot" />
                    前奏 · 摩斯暗号
                  </span>
                  <span className="font-mono">{fmt(Math.min(currentTime * 1000, introMs))} / {fmt(introMs)}</span>
                </div>

                {/* letters — 词组模式 or 单词模式 */}
                <div className="text-center mb-2" style={{ fontFamily: 'var(--font-display)', minHeight: '1.1em' }}>
                  {isPhraseMode ? (
                    <div
                      className="flex justify-center items-baseline flex-nowrap"
                      style={{
                        fontSize: '1.15rem',
                        fontStyle: 'italic',
                        letterSpacing: '0.015em',
                        lineHeight: 1,
                        padding: '10px 0 8px',
                      }}
                    >
                      {phraseChars.map((ch, i) => {
                        const isHero = heroSet?.has(i);
                        const isSpace = ch === ' ';
                        const isPlayed = playedHeroSet?.has(i);
                        const isCurrent = currentHeroIdx === i;

                        if (isSpace) {
                          return <span key={i} style={{ display: 'inline-block', width: '0.45em' }}>&nbsp;</span>;
                        }

                        const base = {
                          display: 'inline-block',
                          transition: 'color 0.45s ease, text-shadow 0.45s ease, transform 0.45s ease',
                        };

                        if (isHero) {
                          return (
                            <span
                              key={i}
                              style={{
                                ...base,
                                fontSize: '2rem',
                                fontStyle: 'normal',
                                fontWeight: 500,
                                letterSpacing: 0,
                                lineHeight: 1,
                                margin: '0 0.06em',
                                color: isCurrent
                                  ? 'var(--gold-100)'
                                  : isPlayed
                                    ? 'rgba(242,239,232,0.9)'
                                    : 'rgba(242,239,232,0.55)',
                                textShadow: isCurrent ? '0 0 22px rgba(217,201,163,0.6)' : 'none',
                                transform: isCurrent ? 'translateY(-2px) scale(1.06)' : 'none',
                              }}
                            >
                              {ch}
                            </span>
                          );
                        }

                        return (
                          <span key={i} style={{ ...base, color: 'rgba(242,239,232,0.3)' }}>
                            {ch}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className="flex justify-center gap-1 flex-wrap"
                      style={{ fontSize: letters.length > 5 ? '1.45rem' : '2.25rem', letterSpacing: letters.length > 5 ? '0.09em' : '0.16em', lineHeight: 1 }}
                    >
                      {letters.map((ch, i) => (
                        <span
                          key={i}
                          className="inline-block transition-all duration-500"
                          style={{
                            color: i < currentLetterIdx ? 'rgba(242,239,232,0.78)' : i === currentLetterIdx ? 'var(--gold-100)' : 'rgba(242,239,232,0.08)',
                            transform: i < currentLetterIdx ? 'translateY(0)' : i === currentLetterIdx ? 'translateY(-2px) scale(1.06)' : 'translateY(4px)',
                            textShadow: i === currentLetterIdx ? '0 0 18px rgba(201,162,74,0.4)' : 'none',
                          }}
                        >
                          {ch}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* morse animated — key 包含 morseSig 以便每次切换重建 span、重跑动画 */}
                <div className="text-center mb-2.5" style={{ fontFamily: 'var(--font-mono)', minHeight: '1.35em' }}>
                  <div className="flex justify-center items-center gap-3" style={{ opacity: currentTime * 1000 > introMs ? 0.32 : 0.88 }}>
                    {morseSpans?.map(({ ch, eff, delay, key }) => {
                      const isDot = ch === '.' || ch === '·';
                      const isDash = ch === '-' || ch === '−';
                      return (
                        <span
                          key={`${morseSig || 'init'}-${key}`}
                          className={`sym ${eff}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            animationDelay: delay + 'ms',
                            color: 'var(--gold-100)',
                            fontSize: isDot || isDash ? 0 : '1.05rem',
                            fontWeight: isDot || isDash ? undefined : 700,
                            minHeight: 12,
                          }}
                        >
                          {isDot ? (
                            <span
                              className="rounded-full flex-shrink-0"
                              style={{
                                width: 9,
                                height: 9,
                                background: 'var(--gold-100)',
                                boxShadow: '0 0 11px rgba(242,210,122,0.9), 0 0 3px rgba(255,248,220,0.85)',
                              }}
                              aria-hidden="true"
                            />
                          ) : isDash ? (
                            <span
                              className="rounded-full flex-shrink-0"
                              style={{
                                width: 32,
                                height: 9,
                                background: 'linear-gradient(90deg, var(--gold-600), var(--gold-100), var(--gold-400))',
                                boxShadow: '0 0 11px rgba(201,162,74,0.8), inset 0 1px 0 rgba(255,255,255,0.2)',
                              }}
                              aria-hidden="true"
                            />
                          ) : (
                            ch
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* intro progress */}
                <div className="relative h-3 mb-1">
                  <div className="absolute inset-0 top-1/2 -translate-y-1/2 h-px" style={{ background: 'rgba(201,162,74,0.18)' }} />
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 h-px" style={{ width: (introRatio * 100) + '%', background: 'linear-gradient(90deg, rgba(201,162,74,0.6), var(--gold-100))', transition: 'width 0.08s linear' }} />
                  <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ left: (introRatio * 100) + '%', background: 'var(--gold-100)', boxShadow: '0 0 10px var(--gold-100)', transform: 'translate(-50%, -50%)', transition: 'left 0.08s linear' }} />
                </div>
              </div>

              <div className="h-px my-3" style={{ background: 'linear-gradient(90deg, transparent, rgba(201,162,74,0.22), transparent)' }} />

              {/* audio */}
              <div>
                <div
                  className="relative h-6 -my-2 flex items-center cursor-pointer group select-none"
                  role="slider"
                  aria-label="播放进度"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration || 0)}
                  aria-valuenow={Math.round(currentTime)}
                  style={{ touchAction: 'none' }}
                  onPointerDown={(e) => {
                    if (!audioRef.current || !duration) return;
                    e.preventDefault();
                    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
                    isSeekingRef.current = true;
                    haptic(4);
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    const t = ratio * duration;
                    audioRef.current.currentTime = t;
                    setCurrentTime(t);
                  }}
                  onPointerMove={(e) => {
                    if (!isSeekingRef.current || !audioRef.current || !duration) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    const t = ratio * duration;
                    audioRef.current.currentTime = t;
                    setCurrentTime(t);
                  }}
                  onPointerUp={(e) => {
                    if (!isSeekingRef.current) return;
                    isSeekingRef.current = false;
                    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
                  }}
                  onPointerCancel={() => { isSeekingRef.current = false; }}
                >
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full group-hover:h-1 transition-all pointer-events-none" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full group-hover:h-1 transition-all pointer-events-none"
                    style={{ width: (progressRatio * 100) + '%', background: 'linear-gradient(90deg, var(--gold-600), var(--gold-400), var(--gold-100))' }}
                  />
                  <div
                    className="absolute top-1/2 w-3 h-3 rounded-full group-hover:scale-125 transition-transform pointer-events-none"
                    style={{ left: (progressRatio * 100) + '%', background: 'var(--gold-100)', boxShadow: '0 0 8px rgba(242,210,122,1)', transform: 'translate(-50%, -50%)' }}
                  />
                </div>
                <div className="flex justify-between text-[11px] font-mono mb-3">
                  <span style={{ color: 'var(--gold-100)' }}>{fmtAudio(currentTime)}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{fmtAudio(duration)}</span>
                </div>

                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    aria-label={isPlaying ? '暂停' : '播放'}
                    onClick={handlePlayPause}
                    className="btn-primary btn-tactile w-12 h-12 rounded-full flex items-center justify-center"
                  >
                    {isPlaying
                      ? <Pause className="w-5 h-5 fill-[#1a1a1a]" />
                      : <Play className="w-5 h-5 fill-[#1a1a1a] ml-0.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={handleAudioTimeUpdate}
        onLoadedMetadata={handleAudioLoaded}
        onEnded={handleAudioEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      {/* morse symbol animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50%      { opacity: 1;   transform: scale(1.15); }
        }
        @keyframes morseBloom {
          0%   { opacity: 0; transform: translateY(14px) scale(0.4); filter: blur(3px); }
          35%  { opacity: 1; transform: translateY(-4px) scale(1.35); filter: blur(0); text-shadow: 0 0 26px rgba(242,210,122,0.95), 0 0 8px rgba(255,240,200,0.8); }
          65%  { transform: translateY(0) scale(1.04); text-shadow: 0 0 16px rgba(201,162,74,0.55); }
          100% { opacity: 1; transform: translateY(0) scale(1); text-shadow: 0 0 10px rgba(201,162,74,0.35); }
        }
        @keyframes morseHit {
          0%   { opacity: 0; transform: translateY(-6px) scale(1.7); filter: blur(1.5px); }
          8%   { opacity: 1; transform: translateY(0) scale(1.45); filter: blur(0); text-shadow: 0 0 30px rgba(255,248,225,1), 0 0 14px rgba(255,238,200,0.9); }
          22%  { transform: translateY(1px) scale(0.82); text-shadow: 0 0 14px rgba(201,162,74,0.55); }
          45%  { transform: translateY(0) scale(1.08); text-shadow: 0 0 12px rgba(201,162,74,0.45); }
          100% { opacity: 1; transform: translateY(0) scale(1); text-shadow: 0 0 8px rgba(201,162,74,0.3); }
        }
        @keyframes morseRipple {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.22); border-width: 1.8px; }
          8%   { opacity: 0.95; transform: translate(-50%, -50%) scale(0.45); border-width: 1.6px; }
          40%  { opacity: 0.55; transform: translate(-50%, -50%) scale(1.35); border-width: 1.2px; }
          75%  { opacity: 0.22; transform: translate(-50%, -50%) scale(2.4); border-width: 0.8px; }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(3.3); border-width: 0.4px; }
        }
        @keyframes morseCrisp {
          0%   { opacity: 0; transform: scale(0.85); filter: blur(0.6px); }
          14%  { opacity: 1; transform: scale(1.2); filter: blur(0); text-shadow: 0 0 16px rgba(255,245,215,0.95); }
          32%  { transform: translateX(0.8px) scale(0.96); text-shadow: 0 0 6px rgba(201,162,74,0.45); }
          55%  { transform: translateX(-0.6px) scale(1.03); }
          80%  { transform: translateX(0.2px) scale(1); }
          100% { opacity: 1; transform: translateX(0) scale(1); text-shadow: 0 0 5px rgba(201,162,74,0.28); }
        }
        @keyframes morsePixel {
          0%   { opacity: 0; transform: scale(0.55); }
          16%  { opacity: 1; transform: scale(1.3); text-shadow: 2px 0 0 rgba(201,162,74,0.7), -2px 0 0 rgba(120,200,160,0.4); }
          33%  { opacity: 0.4; transform: scale(0.8); text-shadow: none; }
          50%  { opacity: 1; transform: scale(1.12); text-shadow: 1px 0 0 rgba(201,162,74,0.6); }
          66%  { opacity: 0.7; transform: scale(0.95); }
          83%  { opacity: 1; transform: scale(1.04); text-shadow: 0 0 4px rgba(201,162,74,0.45); }
          100% { opacity: 1; transform: scale(1); text-shadow: 0 0 3px rgba(201,162,74,0.3); }
        }
        @keyframes morsePluck {
          0%   { opacity: 0; transform: translateX(0) scaleX(1.3) scaleY(0.8); }
          10%  { opacity: 1; transform: translateX(2.5px) scaleX(1.08) scaleY(0.96); text-shadow: 0 0 14px rgba(201,162,74,0.75); }
          24%  { transform: translateX(-2.2px) scaleX(0.95) scaleY(1.06); text-shadow: 0 0 10px rgba(201,162,74,0.55); }
          40%  { transform: translateX(1.5px) scaleX(1.03) scaleY(0.98); }
          55%  { transform: translateX(-1px); }
          70%  { transform: translateX(0.5px); }
          85%  { transform: translateX(-0.2px); }
          100% { opacity: 1; transform: translateX(0) scale(1); text-shadow: 0 0 6px rgba(201,162,74,0.3); }
        }
        .sym.bloom { animation: morseBloom 0.65s cubic-bezier(0.22, 1.1, 0.36, 1) forwards; }
        .sym.hit   { position: relative; animation: morseHit 0.7s cubic-bezier(0.24, 0.9, 0.22, 1) forwards; }
        .sym.hit::after {
          content: ""; position: absolute; left: 50%; top: 55%;
          width: 2.35rem; height: 2.35rem;
          border: 1.4px solid rgba(201,162,74,0.85); border-radius: 50%;
          transform: translate(-50%, -50%) scale(0.25); opacity: 0;
          animation: morseRipple 1.6s cubic-bezier(0.22, 0.55, 0.28, 1) forwards;
          pointer-events: none;
        }
        .sym.crisp { animation: morseCrisp 0.42s cubic-bezier(0.3, 1.1, 0.4, 1) forwards; }
        .sym.pixel { animation: morsePixel 0.52s steps(6, end) forwards; }
        .sym.pluck { animation: morsePluck 0.9s cubic-bezier(0.25, 0.8, 0.3, 1) forwards; }
        .sym { opacity: 0; will-change: transform, opacity, text-shadow, filter; }
      `}</style>
    </div>
  );
};

const shuffleInPlace = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const buildShuffledOptions = (item) => {
  const pairs = item.options.map((text, orig) => ({ text, orig }));
  shuffleInPlace(pairs);
  return {
    labels: pairs.map((p) => p.text),
    correctDisplayIndex: pairs.findIndex((p) => p.orig === item.correctIndex),
  };
};

/* =========================================================
   PlayScreen — 剧情猜码：中文题面 + 四选一摩斯（static-quiz.json）
   ========================================================= */
const PlayScreen = ({ isActive: _isActive = true }) => {
  const bank = staticQuizData.items;
  /** 题目顺序与 JSON 一致，保证故事从第 1 题顺播到最后一题；仅每题的四个选项随机打乱。 */
  const [deck, setDeck] = useState(() => [...bank]);
  const [qIndex, setQIndex] = useState(0);
  const [picked, setPicked] = useState(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const current = deck[qIndex] ?? null;
  const total = deck.length;

  const layout = useMemo(() => {
    if (finished || !deck[qIndex]) return null;
    return buildShuffledOptions(deck[qIndex]);
  }, [deck, qIndex, finished]);

  const restartRound = useCallback(() => {
    haptic(10);
    setDeck([...bank]);
    setQIndex(0);
    setPicked(null);
    setScore(0);
    setFinished(false);
  }, [bank]);

  const onPick = (displayIdx) => {
    if (picked !== null || !layout || finished) return;
    setPicked(displayIdx);
    if (displayIdx === layout.correctDisplayIndex) {
      haptic([8, 40, 12]);
      setScore((s) => s + 1);
    } else {
      haptic([20, 30, 20]);
    }
  };

  const goNext = () => {
    if (picked === null || finished) return;
    haptic(6);
    setPicked(null);
    if (qIndex + 1 >= total) {
      setFinished(true);
      return;
    }
    setQIndex((i) => i + 1);
  };

  const diffLabel = (d) => (d === 'medium' ? '中等' : '简单');

  return (
    <div id="panel-play" role="tabpanel" className="flex flex-col h-full px-5 fade-up-in min-h-0">
      <div className="mt-2 mb-3 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="min-w-0 pr-2">
          <h2 className="text-[22px] font-semibold leading-snug" style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
            {staticQuizData.title}
          </h2>
        </div>
        <button
          type="button"
          aria-label="从第一题重新开始"
          onClick={restartRound}
          className="btn-icon btn-tactile w-10 h-10 flex-shrink-0"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      <div
        className="flex-1 min-h-0 rounded-[28px] p-4 flex flex-col gap-3 overflow-hidden"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
        }}
      >
        {finished ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4 text-center py-8">
            <Sparkles className="w-10 h-10" style={{ color: 'var(--gold-400)' }} aria-hidden="true" />
            <p className="text-lg font-semibold" style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
              故事告一段落
            </p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              答对 <span className="text-gold-grad font-mono font-semibold">{score}</span> / {total} 题
            </p>
            <button
              type="button"
              onClick={restartRound}
              className="btn-tactile px-6 py-2.5 rounded-full text-sm font-medium flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, #7A5B1F 0%, #C9A24A 50%, #F2D27A 100%)',
                color: '#1a1a1a',
              }}
            >
              <RotateCcw className="w-4 h-4" />
              从头再读一遍
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 flex-shrink-0">
              <span className="text-[10px] tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
                第 <strong className="font-mono" style={{ color: 'var(--gold-400)' }}>{qIndex + 1}</strong> / {total} 题
              </span>
              <div className="flex items-center gap-2">
                {current ? (
                  <span
                    className="text-[9px] px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: 'rgba(201,162,74,0.12)',
                      color: 'var(--gold-400)',
                      border: '1px solid rgba(201,162,74,0.25)',
                    }}
                  >
                    {diffLabel(current.difficulty)}
                  </span>
                ) : null}
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-faint)' }}>
                  得分 {score}
                </span>
              </div>
            </div>

            <p className="text-[13px] leading-relaxed flex-shrink-0" style={{ color: 'var(--text)' }}>
              {current?.prompt}
            </p>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-0.5" role="radiogroup" aria-label="摩斯码选项">
              <div className="grid grid-cols-1 gap-2.5 pb-1">
                {layout?.labels.map((label, i) => {
                  const show = picked !== null;
                  const isCorrect = i === layout.correctDisplayIndex;
                  const isWrongPick = show && picked === i && !isCorrect;
                  const baseBorder = '1px solid rgba(255,255,255,0.08)';
                  let border = baseBorder;
                  let bg = 'rgba(0,0,0,0.12)';
                  if (show && isCorrect) {
                    border = '1px solid rgba(74, 222, 128, 0.45)';
                    bg = 'rgba(34, 197, 94, 0.12)';
                  } else if (isWrongPick) {
                    border = '1px solid rgba(248, 113, 113, 0.5)';
                    bg = 'rgba(239, 68, 68, 0.1)';
                  }
                  return (
                    <button
                      key={`${current?.id}-${i}-${label.slice(0, 8)}`}
                      type="button"
                      role="radio"
                      aria-checked={picked === i}
                      disabled={picked !== null}
                      onClick={() => onPick(i)}
                      className="w-full text-left rounded-2xl px-3.5 py-3 transition-all duration-150 btn-tactile disabled:opacity-95"
                      style={{
                        background: bg,
                        border,
                        boxShadow: show && isCorrect ? '0 0 20px rgba(74,222,128,0.15)' : undefined,
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono"
                          style={{
                            background: 'rgba(242,210,122,0.12)',
                            color: 'var(--gold-300)',
                          }}
                        >
                          {String.fromCharCode(65 + i)}
                        </span>
                        <span
                          className="text-[12px] sm:text-[13px] font-mono leading-relaxed break-all flex-1 tracking-[0.04em]"
                          style={{ color: 'var(--gold-100)' }}
                        >
                          {label}
                        </span>
                        {show && isCorrect ? (
                          <Check className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#86efac' }} aria-hidden="true" />
                        ) : null}
                        {isWrongPick ? (
                          <X className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#fca5a5' }} aria-hidden="true" />
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {picked !== null ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1 flex-shrink-0 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                <p className="text-[11px] flex-1" style={{ color: 'var(--text-muted)' }}>
                  {picked === layout.correctDisplayIndex ? (
                    <>答对了。</>
                  ) : (
                    <>
                      正解：<span className="font-mono text-gold-grad">{current?.answerPlaintext}</span>
                    </>
                  )}
                </p>
                <button
                  type="button"
                  onClick={goNext}
                  className="btn-tactile px-4 py-2 rounded-full text-xs font-semibold flex items-center justify-center gap-1.5 self-stretch sm:self-auto"
                  style={{
                    background: 'linear-gradient(135deg, rgba(122,91,31,0.9), rgba(201,162,74,0.95))',
                    color: '#1a1a1a',
                  }}
                >
                  {qIndex + 1 >= total ? '查看结果' : '下一题'}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <p className="text-[10px] text-center pt-1 flex-shrink-0" style={{ color: 'var(--gold-500)' }}>
                点选一组最符合题意的摩斯码 · 仅含英文字母，字母之间用空格分隔
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default App;
