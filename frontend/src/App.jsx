import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, Share2, ChevronLeft, ChevronRight, ChevronsRight, ArrowRight, Zap, Shuffle, List, ListOrdered, Repeat, Repeat1, Delete, GraduationCap, Target, Music2, Sparkles, Check, X, Volume2, VolumeX, Flame, RotateCcw, Gamepad2, Download, Heart, MoreHorizontal, BookMarked } from 'lucide-react';
import { apiUrl } from './api.js';
import staticQuizData from '../../data/static-quiz.json';
import JumpGame from './JumpGame.jsx';
import MorseLetterAnim from './MorseLetterAnim.jsx';
import { startMorseTone, rampMorseTone, stopMorseTone, getMorseAudioContext } from './morseAudio.js';

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
  { id: 'music', label: '声印', icon: Music2,        grow: 1 },
  { id: 'play',  label: '信使', icon: Gamepad2,      grow: 1 },
];

/** Gentle haptic — safe (noop where unsupported). */
const haptic = (pattern = 8) => {
  if (typeof navigator === 'undefined') return;
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
};

/** 答对三音上扬和弦（A5 → D6 → G6） */
const playSuccessChime = () => {
  const ctx = getMorseAudioContext();
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
  const ctx = getMorseAudioContext();
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
  const ctx = getMorseAudioContext();
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
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t === 'learn') return 'play';   // 「摩斯」并入信使的字母教学
      if (t && TABS.some(tab => tab.id === t)) return t;
    } catch (_) {}
    return 'music';
  });
  // 字母教学：从信使 ⋯ 菜单打开的全屏浮层（整合原「摩斯」标签页）
  const [learnOpen, setLearnOpen] = useState(false);

  return (
    <div className="app-page w-full selection:bg-[var(--gold-300)]/25" style={{ color: 'var(--text)' }}>
      <div className="phone-shell">
        <div className="phone-screen">
          <div className="phone-content">
            {/* Tab bar — 顶栏贴顶，无装饰摄像头；真机用 safe-area */}
            <div
              className="relative z-50 px-5 pb-2 flex-shrink-0 pt-[max(6px,env(safe-area-inset-top,0px))]"
            >
              <div
                className="glass-chip flex items-center p-1"
                role="tablist"
                aria-label="主导航"
              >
                {TABS.map(({ id, label, icon: Icon, grow = 1 }) => {
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
                        setLearnOpen(false);   // 切标签时关掉字母教学浮层，避免它盖住新标签内容
                        setActiveTab(id);
                      }}
                      className="ripple relative h-9 rounded-full text-sm font-medium flex items-center justify-center gap-1.5 transition-all duration-300 ease-out"
                    style={{
                      margin: '2px',
                      flex: `${grow} 1 0%`,
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
                {/* 第三个 Tab 由「猜码」切换为「跳一跳」小游戏（PlayScreen 代码保留以便回滚） */}
                <JumpGame isActive={activeTab === 'play'} onOpenLearn={() => setLearnOpen(true)} />
              </div>

              {/* 字母教学浮层：整合原「摩斯」标签页，从信使 ⋯ 菜单进入 */}
              {learnOpen ? (
                <div
                  className="absolute inset-0 z-[70] flex flex-col learn-overlay-enter"
                  style={{ background: 'var(--bg, #0b0a12)' }}
                  role="dialog"
                  aria-modal="true"
                  aria-label="字母教学"
                >
                  <div className="flex items-center justify-between px-5 pt-2 pb-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => { haptic(6); setLearnOpen(false); }}
                      className="btn-tactile flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px]"
                      style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                      aria-label="返回信使"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>返回信使</span>
                    </button>
                    <span className="text-[12px] tracking-wide" style={{ color: 'var(--text-faint)' }}>
                      字母教学
                    </span>
                    <span className="w-[76px]" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-h-0">
                    <LearnScreen isActive={learnOpen} />
                  </div>
                </div>
              ) : null}
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
  // 播放模式：sequence（顺序 A→Z）或 loop（当前字母循环）
  const [playMode, setPlayMode] = useState('sequence');
  const playModeRef = useRef('sequence');
  useEffect(() => { playModeRef.current = playMode; }, [playMode]);

  // 切换字母时清空练习输入（顺序播放等路径不会走 goTo）
  useEffect(() => {
    setTestInput([]);
    setCelebration(null);
    clearTimeout(celebrationTimerRef.current);
  }, [currentIndex]);
  // 动画声音开关
  const [soundOn, setSoundOn] = useState(true);
  const animRef = useRef(null);
  const autoPlayTimerRef = useRef(null);
  const userPlaySessionRef = useRef(false);

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

  // 离开 learn 模式时暂停动画
  useEffect(() => {
    if (mode === 'learn') return;
    clearTimeout(autoPlayTimerRef.current);
    animRef.current?.pause();
    setIsPlaying(false);
  }, [mode]);

  // Learn tab 本身被隐藏（切去 Music/Play）时，暂停动画并释放按键音
  useEffect(() => {
    if (isActive) return;
    animRef.current?.pause();
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
    userPlaySessionRef.current = false;
    haptic(6);
    setCurrentIndex(idx);
    setIsPlaying(false);
    setTestInput([]);
    setTestResult(null);
    setCelebration(null);
  };

  // 顺序播放：用户主动点播放后，切到下一字母时自动续播
  const sequenceAdvanceRef = useRef(false);
  useEffect(() => {
    if (!sequenceAdvanceRef.current || !userPlaySessionRef.current) return;
    sequenceAdvanceRef.current = false;
    const t = setTimeout(() => {
      animRef.current?.restart();
      setIsPlaying(true);
    }, 80);
    return () => clearTimeout(t);
  }, [currentIndex]);

  const handleAnimEnded = () => {
    clearTimeout(autoPlayTimerRef.current);
    setIsPlaying(false);
    if (!userPlaySessionRef.current) return;
    autoPlayTimerRef.current = setTimeout(() => {
      if (playModeRef.current === 'loop') {
        animRef.current?.restart();
        setIsPlaying(true);
      } else if (playModeRef.current === 'sequence') {
        sequenceAdvanceRef.current = true;
        setCurrentIndex((prev) => (prev + 1) % ALPHABET.length);
      }
    }, 2200);
  };

  const togglePlay = () => {
    clearTimeout(autoPlayTimerRef.current);
    haptic(6);
    if (isPlaying) {
      userPlaySessionRef.current = false;
      animRef.current?.pause();
      animRef.current?.showStatic?.();
      setIsPlaying(false);
    } else {
      userPlaySessionRef.current = true;
      animRef.current?.restart();
      setIsPlaying(true);
    }
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
      if (testInput.length >= targetArr.length) return;

      const newInput = [...testInput, type];
      setTestInput(newInput);
      if (newInput.length < targetArr.length) return;

      const isCorrect = newInput.every((v, i) => v === targetArr[i]);
      if (isCorrect) {
        const pick = CELEBRATION_SLOGANS[Math.floor(Math.random() * CELEBRATION_SLOGANS.length)];
        setCelebration({ ...pick, id: Date.now() });
        haptic([14, 40, 14]);
        clearTimeout(celebrationTimerRef.current);
        celebrationTimerRef.current = setTimeout(() => {
          setCelebration(null);
          setTestInput([]);
        }, 2200);
      } else {
        haptic([30, 50, 30]);
        playWrongBuzz();
        clearTimeout(celebrationTimerRef.current);
        celebrationTimerRef.current = setTimeout(() => setTestInput([]), 900);
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

  const renderLearnSlots = () => {
    const targets = morseCode.split('').map(c => c === '.' ? 'dot' : 'dash');
    return (
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {targets.map((target, i) => {
          const inputed = testInput[i];
          const isNext = i === testInput.length;
          const dotSize = 12;
          const dashW = 32;
          const h = 12;
          let bg = 'transparent';
          let border = '1px dashed rgba(201,162,74,0.28)';
          let shadow = 'none';
          if (inputed) {
            const match = inputed === target;
            bg = match
              ? (inputed === 'dot' ? 'var(--gold-100)' : 'linear-gradient(90deg, var(--gold-600), var(--gold-100))')
              : '#fca5a5';
            border = match ? 'none' : '1px solid #f87171';
            shadow = match ? '0 0 10px rgba(242,210,122,0.55)' : '0 0 8px rgba(248,113,113,0.5)';
          } else if (isNext) {
            border = '1px solid rgba(242,210,122,0.45)';
            shadow = '0 0 8px rgba(242,210,122,0.25)';
          }
          return (
            <div
              key={i}
              className="rounded-full transition-all duration-150"
              style={{
                width: target === 'dot' ? dotSize : dashW,
                height: h,
                background: inputed ? bg : 'transparent',
                border,
                boxShadow: shadow,
                opacity: inputed || isNext ? 1 : 0.45,
              }}
            />
          );
        })}
      </div>
    );
  };

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
      <div className={`flex items-center flex-shrink-0 mt-2 mb-3 ${mode === 'test' ? 'grid grid-cols-[1fr_auto_1fr] gap-2' : 'justify-between'}`}>
        {mode === 'test' ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[13px] tabular-nums whitespace-nowrap">
              <span style={{ color: 'var(--text)' }} className="font-semibold">{testScore}</span>
              <span className="opacity-35">/</span>
              <span style={{ color: 'var(--text-muted)' }}>{testTotal}</span>
            </span>
            <span className="w-px h-3 self-center opacity-30" style={{ background: 'var(--gold-300)' }} aria-hidden="true" />
            <span className="text-[13px] font-semibold tabular-nums whitespace-nowrap" style={{ color: 'var(--gold-100)' }}>
              {testTotalScore}<span className="text-[10px] font-normal ml-0.5 opacity-75">分</span>
            </span>
            {testStreak >= 2 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-bold flex items-center gap-0.5"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,120,60,0.25), rgba(242,210,122,0.3))',
                  color: '#FFD88A',
                  border: '1px solid rgba(255,150,70,0.5)',
                }}
              >
                <Flame className="w-3 h-3" strokeWidth={2.6} />×{testStreak}
              </span>
            )}
          </div>
        ) : (
        <span className="text-2xl font-mono" style={{ color: 'var(--text-muted)' }}>
            <span>{currentIndex + 1} <span className="opacity-50">/</span> 26</span>
        </span>
        )}

        {/* Mode switch */}
        <div
          className="flex items-center p-1 rounded-full justify-self-center"
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
            className="btn-ghost btn-tactile px-3 h-7 text-xs font-medium justify-self-end"
          >
            {testLetter ? '重置' : '开始'}
          </button>
        )}
      </div>

      {/* ========== Learn mode ========== */}
      {mode === 'learn' && (
        <>
          {/* 摩斯字母动画（纯代码，替代 letter/*.mp4） */}
          <div
            className="w-full rounded-2xl overflow-hidden relative flex-shrink-0"
            style={{ height: '27vh', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}
          >
            <MorseLetterAnim
              key={currentLetter}
              ref={animRef}
              letter={currentLetter}
              soundOn={soundOn}
              onPlayingChange={setIsPlaying}
              onEnded={handleAnimEnded}
            />
            {/* corner chip */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full glass-chip pointer-events-none">
              {!isPlaying ? <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-faint)' }} /> : <span className="live-dot" />}
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
                aria-label={soundOn ? '关闭动画声音' : '开启动画声音'}
                aria-pressed={soundOn}
                onClick={() => { haptic(4); setSoundOn(v => !v); }}
                className="btn-icon btn-tactile w-9 h-9"
                style={soundOn ? { color: 'var(--gold-100)', borderColor: 'rgba(201,162,74,0.4)' } : undefined}
              >
                {soundOn ? <Volume2 className="w-[16px] h-[16px]" /> : <VolumeX className="w-[16px] h-[16px]" />}
              </button>
              <button
                type="button"
                aria-label={isPlaying ? '暂停' : '从头播放'}
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

            <div className="text-center w-full px-2">
              <div
                className="min-h-[40px] flex flex-col items-center justify-center gap-2 transition-opacity duration-200"
                style={{ opacity: celebration ? 0 : 1 }}
                aria-hidden={!!celebration}
              >
                {(testInput.length > 0 || isPressing) && !celebration ? (
                  <div className="flex items-center justify-center gap-3 fade-up-in w-full">
                    {renderLearnSlots()}
                    <button
                      type="button"
                      aria-label="清空练习输入"
                      title="清空"
                      onClick={() => { haptic(10); setTestInput([]); setCelebration(null); }}
                      className="btn-tactile w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        background: 'rgba(201,162,74,0.08)',
                        border: '1px solid rgba(201,162,74,0.32)',
                        color: 'var(--gold-100)',
                      }}
                    >
                      <X className="w-3.5 h-3.5" strokeWidth={2.4} />
                    </button>
                  </div>
                ) : (
                  renderLearnSlots()
                )}
                {!celebration && (
                  <p className="text-[10px] tracking-wide" style={{ color: 'var(--text-faint)' }}>
                    {testInput.length > 0
                      ? `已敲 ${testInput.length} / ${morseCode.length}`
                      : `跟读敲出 ${morseCode.length} 个符号`}
                  </p>
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

            {/* 电键操作提示 —— 未开始输入时轻柔呼吸引导 */}
            <div
              className="flex items-center gap-4 text-[11px] transition-opacity duration-300"
              style={{ color: 'var(--text-faint)', opacity: (testInput.length > 0 || celebration || isPressing) ? 0 : 1 }}
              aria-hidden="true"
            >
              <span className="flex items-center gap-1.5 hint-breath">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--gold-100)', boxShadow: '0 0 6px var(--gold-100)' }} />
                短按 · 点
              </span>
              <span className="flex items-center gap-1.5 hint-breath" style={{ animationDelay: '0.5s' }}>
                <span className="inline-block w-5 h-1.5 rounded-full" style={{ background: 'linear-gradient(90deg, var(--gold-600), var(--gold-100))' }} />
                长按 · 划
              </span>
            </div>
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
                <h3 className="text-[22px] font-semibold mb-1.5" style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
                  摩斯挑战赛
                </h3>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  看字母 · 敲摩斯 · 拼速度与准度
                </p>
              </div>
              {testBestStreak > 0 && (
                <div
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px]"
                  style={{ background: 'rgba(201,162,74,0.1)', border: '1px solid rgba(201,162,74,0.3)', color: 'var(--gold-100)' }}
                >
                  <Sparkles className="w-3.5 h-3.5" strokeWidth={2.4} />
                  历史最佳连击 × {testBestStreak}
                </div>
              )}
              <button
                type="button"
                onClick={startTest}
                className="btn-primary btn-tactile ripple px-8 h-11 rounded-full text-[13px] font-semibold flex items-center gap-2"
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
            className="flex-shrink-0 relative rounded-3xl px-4 py-4"
            style={{
              background: 'var(--surface-sunken)',
              border: '1px solid var(--border-subtle)',
              animation: shakeTick > 0 && testResult === 'wrong'
                ? 'testShake 0.55s cubic-bezier(.36,.07,.19,.97), testRedFlash 0.7s ease-out'
                : undefined,
            }}
          >
            <div className="flex flex-col items-center relative gap-3">
              <p className="text-[12px] tracking-[0.14em] font-medium" style={{ color: 'var(--gold-400)' }}>
                敲出这个字母
              </p>

              {/* 大字母 + 浮字 */}
              <div className="relative">
                <div
                  className="text-[68px] leading-none font-light text-gold-grad"
                  style={{
                    fontFamily: 'var(--font-display)',
                    filter: 'drop-shadow(0 0 24px rgba(242,210,122,0.4))',
                    transform: testResult === 'correct' ? 'scale(1.05)' : 'scale(1)',
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

              {/* Morse 填空 */}
              <div className="flex items-center justify-center gap-2.5 min-h-[24px]">
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

              {/* 结果反馈 */}
              <div className="min-h-[40px] flex items-center justify-center w-full">
                {testResult === 'correct' && testSpeedScore !== null && (
                  <div className="flex items-center gap-2.5 fade-up-in">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3].map(s => (
                        <span key={s} className="text-lg" style={{ color: s <= getStars() ? 'var(--gold-100)' : 'rgba(201,162,74,0.2)' }}>★</span>
                      ))}
                    </div>
                    {testStreak > 1 && (
                      <span
                        className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: 'linear-gradient(135deg, rgba(122,91,31,0.5), rgba(201,162,74,0.42))', color: 'var(--gold-100)', border: '1px solid rgba(242,210,122,0.5)' }}
                      >
                        连击 ×{testStreak}
                      </span>
                    )}
                  </div>
                )}
                {testResult === 'wrong' && (
                  <div
                    className="w-full max-w-[260px] px-3 py-2.5 rounded-2xl flex flex-col items-center gap-2 fade-up-in"
                    style={{ background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.22)' }}
                  >
                    <div className="flex items-center gap-1.5">
                      <X className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--error)' }} />
                      <span className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>正确答案</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className="text-2xl font-light leading-none"
                        style={{ fontFamily: 'var(--font-display)', color: 'var(--gold-100)' }}
                      >
                        {testLetter}
                      </span>
                      {renderSignals(MORSE_MAP[testLetter].split('').map(c => c === '.' ? 'dot' : 'dash'))}
                    </div>
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

          <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-0 py-2">
            <p className="text-[12px] font-medium text-center px-4" style={{ color: testResult === 'wrong' ? 'var(--text-muted)' : 'var(--text-faint)' }}>
              {testInput.length > 0 && !testResult
                ? `已输入 ${testInput.length} / ${targetArr.length}`
                : testResult === null
                  ? '按住电键 · 输入摩斯信号'
                  : testResult === 'correct' ? '漂亮！准备下一题' : '别灰心，再试一次'}
            </p>

            <MorseKey
              size={120}
              iconSize={44}
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
            <div className="flex items-center gap-2 mb-3 pt-1 flex-shrink-0 w-full">
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
                className="btn-icon btn-tactile w-11 h-11 rounded-xl flex-shrink-0"
                style={{ opacity: (testInput.length === 0 || testResult !== null) ? 0.4 : 1 }}
              >
                <Delete className="w-[18px] h-[18px]" />
              </button>

              <div className="flex flex-1 items-center gap-2 min-w-0">
                {testResult === 'wrong' && (
                  <button
                    type="button"
                    onClick={() => { haptic(6); setTestInput([]); setTestResult(null); setTestSpeedScore(null); setTestQuestionStartTime(Date.now()); }}
                    className="btn-ghost btn-tactile flex-1 min-w-0 h-11 rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-semibold whitespace-nowrap"
                  >
                    <Repeat className="w-4 h-4 flex-shrink-0" strokeWidth={2.4} />
                    <span>再试一次</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => { haptic(8); startTest(); }}
                  className="btn-primary btn-tactile ripple flex-1 min-w-0 h-11 rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-semibold whitespace-nowrap"
                  onMouseDown={triggerRipple}
                  style={testResult !== 'wrong' ? { flex: 2 } : undefined}
                >
                  <ArrowRight className="w-4 h-4 flex-shrink-0" strokeWidth={2.4} />
                  <span>{testResult === null ? '跳过' : '下一题'}</span>
                </button>
              </div>

              <button
                type="button"
                aria-label={testSeqMode === 'sequential' ? '切换为随机出题' : '切换为顺序出题'}
                onClick={() => { haptic(6); setTestSeqMode(prev => prev === 'random' ? 'sequential' : 'random'); }}
                className="btn-icon btn-tactile w-11 h-11 rounded-xl flex-shrink-0 transition-all"
                style={{
                  background: testSeqMode === 'sequential' ? 'rgba(201,162,74,0.12)' : 'var(--surface-sunken)',
                  border: `1px solid ${testSeqMode === 'sequential' ? 'rgba(201,162,74,0.4)' : 'var(--border-subtle)'}`,
                  color: testSeqMode === 'sequential' ? 'var(--gold-100)' : 'var(--text-muted)',
                }}
              >
                {testSeqMode === 'random'
                  ? <Shuffle className="w-[18px] h-[18px]" />
                  : <List className="w-[18px] h-[18px]" />}
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

/* ===== 长按蓄力闪电环 —— Canvas 分形闪电，每隔数帧随机重绘 ===== */
const fractalLightning = (x1, y1, x2, y2, roughness, depth) => {
  if (depth === 0) return [[x1, y1], [x2, y2]];
  const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * roughness;
  const my = (y1 + y2) / 2 + (Math.random() - 0.5) * roughness;
  const left  = fractalLightning(x1, y1, mx, my, roughness * 0.58, depth - 1);
  const right = fractalLightning(mx, my, x2, y2, roughness * 0.58, depth - 1);
  return [...left.slice(0, -1), [mx, my], ...right.slice(1)];
};

const drawBolt = (ctx, pts, glowW, coreW, glowColor, coreColor) => {
  // glow pass
  ctx.save();
  ctx.strokeStyle = glowColor;
  ctx.lineWidth   = glowW;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.shadowColor = glowColor;
  ctx.shadowBlur  = 14;
  ctx.beginPath();
  pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.stroke();
  ctx.restore();
  // bright core
  ctx.save();
  ctx.strokeStyle = coreColor;
  ctx.lineWidth   = coreW;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur  = 3;
  ctx.beginPath();
  pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.stroke();
  ctx.restore();
};

const LightningArc = ({ size, intensity }) => {
  const canvasRef  = useRef(null);
  const rafRef     = useRef(null);
  const frameRef   = useRef(0);
  const prevIntRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = size * 2, H = size * 2;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cx = size, cy = size;
    const innerR = size * 0.54;

    const redraw = (intens) => {
      ctx.clearRect(0, 0, W, H);
      if (intens <= 0) return;

      const numBolts  = Math.max(2, Math.round(2 + intens * 5));
      const outerBase = innerR + size * (0.14 + intens * 0.30);
      const roughness = size * 0.14 * intens;
      const depth     = intens > 0.5 ? 5 : 4;

      for (let b = 0; b < numBolts; b++) {
        const baseAngle = (b / numBolts) * Math.PI * 2;
        const angle   = baseAngle + (Math.random() - 0.5) * 0.35;
        const outerR  = outerBase + (Math.random() - 0.5) * size * 0.12;

        const x1 = cx + Math.cos(angle) * innerR;
        const y1 = cy + Math.sin(angle) * innerR;
        const x2 = cx + Math.cos(angle) * outerR;
        const y2 = cy + Math.sin(angle) * outerR;

        const alpha  = Math.min(1, 0.55 + (intens - 0.15) * 1.1);
        const pts    = fractalLightning(x1, y1, x2, y2, roughness, depth);

        drawBolt(ctx, pts,
          3.8, 0.9,
          `rgba(242,210,122,${alpha * 0.55})`,
          `rgba(255,252,230,${alpha})`
        );

        // 分叉支路（强度 > 0.35 时才出现）
        if (intens > 0.35 && Math.random() > 0.35) {
          const forkIdx = Math.floor(pts.length * 0.25 + Math.random() * pts.length * 0.45);
          if (forkIdx < pts.length) {
            const [fx, fy] = pts[forkIdx];
            const fAngle  = angle + (Math.random() < 0.5 ? 1 : -1) * (0.4 + Math.random() * 0.6);
            const fLen    = size * (0.10 + Math.random() * 0.13) * intens;
            const fPts    = fractalLightning(fx, fy,
              fx + Math.cos(fAngle) * fLen,
              fy + Math.sin(fAngle) * fLen,
              roughness * 0.45, depth - 2);
            drawBolt(ctx, fPts,
              1.8, 0.5,
              `rgba(242,210,122,${alpha * 0.38})`,
              `rgba(255,252,230,${alpha * 0.7})`
            );
          }
        }
      }
    };

    let skip = 0;
    const loop = () => {
      frameRef.current++;
      // 每 3 帧重绘一次（约 20 fps），产生真实抖动感
      if (frameRef.current % 3 === 0) redraw(prevIntRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => { cancelAnimationFrame(rafRef.current); };
  }, [size]);   // size 改变才重建；intensity 通过 ref 传入，不触发 effect

  useEffect(() => { prevIntRef.current = intensity; }, [intensity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute top-1/2 left-1/2 pointer-events-none"
      style={{ transform: 'translate(-50%, -50%)', display: intensity > 0 ? 'block' : 'none' }}
    />
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

/* 离线「精选电台」曲库：抖音互动空间无后端，实时生成不可用，
   改为播放随包携带的预生成曲目（与 renderResult 的数据结构对齐）。
   音频文件随构建放在 dist 根目录 songs/ 下，使用相对路径。 */
const OFFLINE_RADIO = [
  {
    word: 'LOVE', sub: '把说不出口的爱，敲成一段旋律', style_label: '治愈钢琴',
    audio_url: 'songs/love.mp3', hook_key: 'C 大调五声', hook_bpm: 86.1,
    morse_pretty: '·−·· −−− ···− ·', intro_duration_ms: 6000, intro_anim_delay_ms: 0, demo: false,
    letter_timeline: [
      { letter: 'L', morse: '.-..', morse_pretty: '·−··', start_ms: 0.0,    end_ms: 1249.9, dot_effect: 'bloom', dash_effect: 'pluck' },
      { letter: 'O', morse: '---',  morse_pretty: '−−−',  start_ms: 1624.9, end_ms: 3374.9, dot_effect: 'bloom', dash_effect: 'pluck' },
      { letter: 'V', morse: '...-', morse_pretty: '···−', start_ms: 3749.9, end_ms: 4999.8, dot_effect: 'bloom', dash_effect: 'pluck' },
      { letter: 'E', morse: '.',    morse_pretty: '·',    start_ms: 5374.8, end_ms: 5499.8, dot_effect: 'bloom', dash_effect: 'pluck' },
    ],
  },
  {
    word: 'HOME', sub: '无论多远，心里都有回家的节拍', style_label: '民谣原声',
    audio_url: 'songs/home.mp3', hook_key: 'A 小调五声', hook_bpm: 123.0,
    morse_pretty: '···· −−− −− ·', intro_duration_ms: 7200, intro_anim_delay_ms: 0, demo: false,
    letter_timeline: [
      { letter: 'H', morse: '....', morse_pretty: '····', start_ms: 0.0,    end_ms: 1050.0, dot_effect: 'crisp', dash_effect: 'pluck' },
      { letter: 'O', morse: '---',  morse_pretty: '−−−',  start_ms: 1500.0, end_ms: 3600.0, dot_effect: 'crisp', dash_effect: 'pluck' },
      { letter: 'M', morse: '--',   morse_pretty: '−−',   start_ms: 4050.0, end_ms: 5400.0, dot_effect: 'crisp', dash_effect: 'pluck' },
      { letter: 'E', morse: '.',    morse_pretty: '·',    start_ms: 5849.9, end_ms: 5999.9, dot_effect: 'crisp', dash_effect: 'pluck' },
    ],
  },
  {
    word: 'STAR', sub: '许一个愿，让它藏进星海的和弦', style_label: '梦境迷幻',
    audio_url: 'songs/star.mp3', hook_key: 'A 大调五声', hook_bpm: 68.0,
    morse_pretty: '··· − ·− ·−·', intro_duration_ms: 4898, intro_anim_delay_ms: 0, demo: false,
    letter_timeline: [
      { letter: 'S', morse: '...', morse_pretty: '···', start_ms: 0.0,    end_ms: 765.3,  dot_effect: 'bloom', dash_effect: 'hit' },
      { letter: 'T', morse: '-',   morse_pretty: '−',   start_ms: 1224.5, end_ms: 1836.7, dot_effect: 'bloom', dash_effect: 'hit' },
      { letter: 'A', morse: '.-',  morse_pretty: '·−',  start_ms: 2295.9, end_ms: 3214.3, dot_effect: 'bloom', dash_effect: 'hit' },
      { letter: 'R', morse: '.-.', morse_pretty: '·−·', start_ms: 3673.5, end_ms: 4898.0, dot_effect: 'bloom', dash_effect: 'hit' },
    ],
  },
  {
    word: 'DREAM', sub: '所有未完成的梦，都在这段电波里', style_label: '电影叙事',
    audio_url: 'songs/dream.mp3', hook_key: 'D 小调', hook_bpm: 117.5,
    morse_pretty: '−·· ·−· · ·− −−', intro_duration_ms: 6000, intro_anim_delay_ms: 0, demo: false,
    letter_timeline: [
      { letter: 'D', morse: '-..', morse_pretty: '−··', start_ms: 0.0,    end_ms: 1000.0, dot_effect: 'hit', dash_effect: 'hit' },
      { letter: 'R', morse: '.-.', morse_pretty: '·−·', start_ms: 1374.9, end_ms: 2374.9, dot_effect: 'hit', dash_effect: 'hit' },
      { letter: 'E', morse: '.',   morse_pretty: '·',   start_ms: 2749.9, end_ms: 2874.9, dot_effect: 'hit', dash_effect: 'hit' },
      { letter: 'A', morse: '.-',  morse_pretty: '·−',  start_ms: 3249.9, end_ms: 3999.8, dot_effect: 'hit', dash_effect: 'hit' },
      { letter: 'M', morse: '--',  morse_pretty: '−−',  start_ms: 4374.8, end_ms: 5499.8, dot_effect: 'hit', dash_effect: 'hit' },
    ],
  },
];

const FALLBACK_STYLES = [
  { id: 'healing',    label: '治愈'   },
  { id: 'electronic', label: '电子'  },
  { id: 'jazz',       label: '爵士'  },
  { id: 'classical',  label: '古典'  },
  { id: 'rock',       label: '摇滚'  },
  { id: 'folk',       label: '民谣'  },
  { id: 'cinematic',  label: '史诗'  },
  { id: 'lofi',       label: 'Lo-Fi' },
  { id: 'pop',        label: 'Pop'   },
];

const MusicScreen = ({ isActive = true }) => {
  const [word, setWord] = useState('');
  const [styles, setStyles] = useState(FALLBACK_STYLES);
  const [selectedStyle, setSelectedStyle] = useState('healing');
  const [withVocals, setWithVocals] = useState(false);
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState('');
  const [genProgress, setGenProgress] = useState(0);      // 异步生成进度 0-100
  const [genStage, setGenStage] = useState('');           // 当前阶段中文标签
  const genPollRef = useRef(null);                        // 轮询定时器
  const previewRef = useRef(null);                        // Web Audio 即时预览上下文
  const [previewPlaying, setPreviewPlaying] = useState(false);
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
  const [showSongMenu,   setShowSongMenu]   = useState(false);
  const [showFavorites,  setShowFavorites]  = useState(false);
  const [isDownloading,  setIsDownloading]  = useState(false);
  const [savedTracks, setSavedTracks] = useState(() => {
    try { return JSON.parse(localStorage.getItem('morse-saved-tracks') || '[]'); } catch { return []; }
  });
  const [curDashEff, setCurDashEff] = useState(null);

  const audioRef = useRef(null);
  const rafRef = useRef(null);
  const isSeekingRef = useRef(false);

  useEffect(() => {
    if (__OFFLINE__) return; // 离线包无后端，保留本地默认风格
    fetch(apiUrl('/api/styles'))
      .then(r => r.json())
      .then(data => { if (data.styles?.length) setStyles(data.styles); })
      .catch(() => { /* 保留本地默认风格 */ });
  }, []);

  // 卸载时清理轮询与预览音频
  useEffect(() => () => {
    if (genPollRef.current) clearInterval(genPollRef.current);
    const p = previewRef.current;
    if (p) { try { p.ctx.close(); } catch (_) {} }
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
    if (timeline.length === 0) return;

    const animDelayMs = result.intro_anim_delay_ms ?? (result.demo ? 6000 : 0);
    if (animDelayMs > 0 && ms < animDelayMs) {
      if (currentLetterIdx !== -1) setCurrentLetterIdx(-1);
      if (currentMorse) {
        setCurrentMorse('');
        setMorseSig(null);
        setCurDotEff(null);
        setCurDashEff(null);
      }
      return;
    }

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

  const loadDemo = async () => {
    if (isGenerating) return;
    haptic(6);
    if (__OFFLINE__) {
      // 离线包无 /api/demo，也不携带碟中谍原声；改播电台里的电影叙事曲
      const track = OFFLINE_RADIO.find(t => t.word === 'DREAM') || OFFLINE_RADIO[0];
      renderResult(track);
      setStatus(''); setStatusKind('');
      return;
    }
    setIsGenerating(true);
    setStatus('加载示例中'); setStatusKind('loading');
    try {
      let data = null;
      try {
        const r = await fetch(apiUrl('/api/demo'));
        if (r.ok) {
          data = await r.json();
        }
      } catch (_) { /* 后端未启动时走静态兜底 */ }
      if (!data?.audio_url) {
        const r = await fetch('/data/mission-demo.json');
        if (!r.ok) throw new Error('static');
        data = await r.json();
      }
      if (!data?.audio_url) throw new Error('invalid');
      renderResult(data);
      setStatus(''); setStatusKind('');
    } catch (_) {
      setStatus('示例加载失败，请确认后端已启动'); setStatusKind('err');
    } finally {
      setIsGenerating(false);
    }
  };

  // 离线电台：点击曲目直接播放随包携带的预生成 mp3
  const playRadioTrack = (track) => {
    haptic(6);
    stopPreview();
    setStatus(''); setStatusKind('');
    renderResult(track);
  };

  // ===== 摩斯 hook 即时预览（Web Audio，零延迟，不依赖后端）=====
  // 与后端 drum_synth.build_morse_hook 的音高映射保持一致
  const HOOK_SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11],
    minor_pent: [0, 3, 5, 7, 10], major_pent: [0, 2, 4, 7, 9],
    dorian: [0, 2, 3, 5, 7, 9, 10],
  };
  const NOTE_SEMI = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };
  // 各风格调式/音色（与后端 styles.py 对齐；缺省 A 小调五声）
  const STYLE_KEY = {
    healing:{root:'C',scale:'major_pent',oct:5}, cinematic:{root:'D',scale:'minor',oct:5},
    retro8bit:{root:'E',scale:'major_pent',oct:5}, oriental:{root:'D',scale:'minor_pent',oct:4},
    dream_pop:{root:'A',scale:'major_pent',oct:5},
  };
  const noteFreq = (root, oct, semi) => {
    const base = NOTE_SEMI[root] ?? 9;
    const midi = 12 * (oct + 1) + base + semi;
    return 440 * Math.pow(2, (midi - 69) / 12);
  };

  const stopPreview = () => {
    const p = previewRef.current;
    if (p) {
      try { p.stopFns.forEach(fn => fn()); } catch (_) {}
      try { p.ctx.close(); } catch (_) {}
      previewRef.current = null;
    }
    setPreviewPlaying(false);
  };

  const playPreview = () => {
    const w = word.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (w.length < 1) { setStatus('请先输入 1–10 个字母'); setStatusKind('err'); return; }
    stopPreview();
    if (isPlaying && audioRef.current) { try { audioRef.current.pause(); } catch (_) {} }

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const key = STYLE_KEY[selectedStyle] || { root: 'A', scale: 'minor_pent', oct: 4 };
    const scale = HOOK_SCALES[key.scale] || HOOK_SCALES.minor_pent;
    const bpm = (styles.find(s => s.id === selectedStyle)?.bpm_hint) || 100;
    const beat = 60 / bpm;
    const dtDot = beat / 2;
    const dtDash = dtDot * 2;

    const tokens = w.split('').map(ch => MORSE_MAP[ch] || '');
    let t = ctx.currentTime + 0.08;
    const stopFns = [];
    tokens.forEach((tok, ti) => {
      let idx = 0;
      for (const sym of tok) {
        const isDash = sym === '-';
        const deg = isDash ? scale[[0,2,4][idx % 3] % scale.length] : scale[idx % scale.length];
        const dur = isDash ? dtDash : dtDot;
        const freq = noteFreq(key.root, key.oct, deg);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = key.scale.includes('pent') ? 'triangle' : 'sine';
        osc.frequency.value = freq;
        const a = 0.006, d = dur * (isDash ? 0.9 : 0.8);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.22, t + a);
        gain.gain.exponentialRampToValueAtTime(0.0008, t + a + d);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.05);
        stopFns.push(() => { try { osc.stop(); } catch (_) {} });
        t += dur;
        idx += 1;
      }
      if (ti < tokens.length - 1) t += dtDot * 0.5;
    });
    const totalMs = (t - ctx.currentTime) * 1000;
    previewRef.current = { ctx, stopFns };
    setPreviewPlaying(true);
    setTimeout(() => { if (previewRef.current?.ctx === ctx) stopPreview(); }, totalMs + 400);
  };

  const humanizeGenError = (raw) => {
    const s = String(raw || '');
    if (/仅支持英文字母|仅字母|A-Z|长度/.test(s)) return '请输入 1–10 个英文字母（A–Z）';
    if (/填写单词|word/i.test(s)) return '请先输入你的词';
    if (/限流|1002/.test(s)) return '用的人有点多，稍后再试';
    if (/余额|1008/.test(s)) return '服务暂时不可用';
    if (/敏感|违规|1026/.test(s)) return '换一个词试试吧';
    return '暂时没能生成，请稍后再试';
  };

  const stopGenPoll = () => {
    if (genPollRef.current) { clearInterval(genPollRef.current); genPollRef.current = null; }
  };

  const handleGenerate = () => {
    if (!word.trim()) { setStatus('请先输入单词'); setStatusKind('err'); return; }
    if (isGenerating) return;
    haptic(10);
    stopPreview();

    if (__OFFLINE__) {
      // 互动空间离线包无后端，不做实时生成；用本地 Web Audio 试听摩斯动机替代，
      // 并引导到「精选电台」体验完整成曲。
      playPreview();
      setStatus('离线体验版：已为你试听摩斯动机，完整成曲请到下方「精选电台」聆听'); setStatusKind('loading');
      return;
    }

    setIsGenerating(true);
    setGenProgress(3);
    setGenStage('排队中');
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

    const onDone = (data) => {
      stopGenPoll();
      renderResult(data);
      setIsGenerating(false); setStatus(''); setStatusKind('');
      setGenProgress(100); setGenStage('');
    };
    const onFail = (raw) => {
      stopGenPoll();
      setStatus(humanizeGenError(raw)); setStatusKind('err');
      setIsGenerating(false); setGenProgress(0); setGenStage('');
    };

    const body = JSON.stringify({ word: word.trim(), style: selectedStyle, with_vocals: withVocals });

    // 优先走异步：立即拿 task_id，再轮询进度；后端不支持时回退同步接口
    fetch(apiUrl('/api/generate/start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })
      .then(async (r) => {
        if (r.status === 404) throw new Error('__NO_ASYNC__');
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.task_id) throw new Error(d.detail || '生成失败');
        return d.task_id;
      })
      .then((taskId) => {
        genPollRef.current = setInterval(() => {
          fetch(apiUrl(`/api/generate/status/${taskId}`))
            .then(r => r.json().catch(() => ({})))
            .then(st => {
              if (typeof st.progress === 'number') setGenProgress(st.progress);
              if (st.stage_label) setGenStage(st.stage_label);
              if (st.status === 'done' && st.result) onDone(st.result);
              else if (st.status === 'error') onFail(st.error);
            })
            .catch(() => { /* 单次轮询失败忽略，等下次 */ });
        }, 1000);
      })
      .catch((e) => {
        if (String(e.message) === '__NO_ASYNC__') {
          // 回退：老的同步接口
          fetch(apiUrl('/api/generate'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
          })
            .then(r => r.json().catch(() => ({})))
            .then(data => { if (!data.audio_url) throw new Error(data.detail || '生成失败'); onDone(data); })
            .catch(err => onFail(err.message));
          return;
        }
        onFail(e.message);
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
      const animDelayMs = data.intro_anim_delay_ms ?? (data.demo ? 6000 : 0);
      if (animDelayMs <= 0) {
        const first0 = data.letter_timeline[0];
        const m0 = first0.morse_pretty || first0.morse || '';
        const deff = first0.dot_effect || data.dot_effect || 'bloom';
        const deff2 = first0.dash_effect || data.dash_effect || 'bloom';
        setMorseSig('init:' + m0 + ':' + deff + ':' + deff2);
        setCurrentMorse(m0);
        setCurDotEff(deff);
        setCurDashEff(deff2);
      } else {
        setMorseSig(null);
        setCurrentMorse('');
        setCurDotEff(null);
        setCurDashEff(null);
      }
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
  const introAnimDelayMs = result?.intro_anim_delay_ms ?? (result?.demo ? 6000 : 0);
  const introAnimReady = introAnimDelayMs <= 0 || currentTime * 1000 >= introAnimDelayMs;
  const displayLetterIdx = introAnimReady ? currentLetterIdx : -1;

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
  // 用 BASE_URL 前缀，兼容离线包的相对 base（'./'）
  const assetBase = import.meta.env.BASE_URL || '/';
  const albumArtSrc = (result?.demo ? 'img/mission-impossible-poster.png' : 'img/album-cover.png');
  const albumArtSrcFull = assetBase + albumArtSrc;
  const albumArtAlt = result?.demo ? 'Mission: Impossible 电影原声封面' : '声印 · 唱片封面';
  const phraseChars = isPhraseMode ? displayPhrase.split('') : [];
  const heroSet = isPhraseMode
    ? new Set((timeline || []).map((iv) => iv.hero_idx).filter((x) => typeof x === 'number'))
    : null;
  let currentHeroIdx = -1;
  let playedHeroSet = null;
  if (isPhraseMode && displayLetterIdx >= 0) {
    playedHeroSet = new Set();
    for (let i = 0; i <= displayLetterIdx; i++) {
      const hi = timeline[i]?.hero_idx;
      if (typeof hi === 'number') playedHeroSet.add(hi);
    }
    const curHi = timeline[displayLetterIdx]?.hero_idx;
    if (typeof curHi === 'number') {
      currentHeroIdx = curHi;
      playedHeroSet.delete(curHi);
    }
  }

  // 当前曲目是否已收藏
  const isSaved = result ? savedTracks.some(t => t.audio_url === result.audio_url) : false;

  // 下载当前曲目
  const handleDownload = async () => {
    if (!result?.audio_url || isDownloading) return;
    haptic(8);
    setIsDownloading(true);
    try {
      const rawUrl = result.audio_url;
      const url = rawUrl.startsWith('http')
        ? rawUrl
        : apiUrl(rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`);
      const name = (result.word || 'morse').toLowerCase().replace(/\s+/g, '_');
      if (__OFFLINE__) {
        // 离线包内音频为同源相对路径，直接锚点下载，避免 fetch/blob
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}_morse.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        const res = await fetch(url);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name}_morse.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }
    } catch (_) {}
    setIsDownloading(false);
    setShowSongMenu(false);
  };

  // 收藏 / 取消收藏
  const handleToggleSave = () => {
    if (!result) return;
    haptic(6);
    const rawUrl = result.audio_url;
    const url = rawUrl.startsWith('http')
      ? rawUrl
      : apiUrl(rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`);
    setSavedTracks(prev => {
      let next;
      if (prev.some(t => t.audio_url === result.audio_url)) {
        next = prev.filter(t => t.audio_url !== result.audio_url);
      } else {
        next = [...prev, {
          audio_url: result.audio_url,
          stream_url: url,
          word: result.word || '',
          style_label: result.style_label || '',
          savedAt: Date.now(),
        }];
      }
      try { localStorage.setItem('morse-saved-tracks', JSON.stringify(next)); } catch (_) {}
      return next;
    });
    setShowSongMenu(false);
  };

  const handlePlayFromFavorites = (track) => {
    haptic(6);
    setShowFavorites(false);
    // 构造一个最小 result 对象，使播放器能正常显示和播放
    const fakeResult = {
      audio_url:   track.audio_url,
      word:        track.word        || '',
      style_label: track.style_label || '声印',
      demo:        false,
      timeline:    [],
    };
    setResult(fakeResult);
    setTimeline([]);
    setCurrentLetterIdx(-1);
    setCurrentMorse('');
    setIsPlaying(false);
    if (audioRef.current) {
      const url = track.stream_url || track.audio_url;
      audioRef.current.src = url;
      audioRef.current.load();
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleRemoveFromFavorites = (trackUrl) => {
    haptic(4);
    setSavedTracks(prev => {
      const next = prev.filter(t => t.audio_url !== trackUrl);
      try { localStorage.setItem('morse-saved-tracks', JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

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
            <div className="min-w-0 flex-1 pr-1">
              <p
                className="text-[15px] leading-tight truncate"
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
          {/* 我的收藏（心形图标；角标挂在外层避免被圆钮裁切） */}
          <div className="relative flex-shrink-0 pr-0.5 pt-0.5">
            <button
              type="button"
              aria-label={`我的收藏（${savedTracks.length} 首）`}
              onClick={() => { haptic(4); setShowFavorites(true); }}
              className="btn-icon btn-tactile w-8 h-8 overflow-visible"
            >
              <Heart className="w-[17px] h-[17px]" strokeWidth={2.2} style={{ color: 'var(--gold-300)' }} />
            </button>
            {savedTracks.length > 0 && (
              <span
                className="pointer-events-none absolute z-20 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white shadow-[0_1px_4px_rgba(0,0,0,0.35)]"
                style={{
                  background: 'linear-gradient(135deg,#f97316,#fb923c)',
                  top: '-2px',
                  right: '-4px',
                }}
              >
                {savedTracks.length > 9 ? '9+' : savedTracks.length}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col space-y-2.5 pr-1">

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

        {/* 精选电台（离线包）：播放随包携带的预生成成曲，弥补无后端实时生成 */}
        {__OFFLINE__ && (
          <div>
            <label className="text-[9.5px] block mb-1 tracking-[0.24em] uppercase font-medium" style={{ color: 'var(--text-muted)' }}>
              精选电台 · 点击即听完整成曲
            </label>
            <div className="flex flex-col gap-2">
              {OFFLINE_RADIO.map((t) => (
                <button
                  key={t.word}
                  type="button"
                  onClick={() => playRadioTrack(t)}
                  className="btn-tactile w-full flex items-center gap-3 px-3 py-2 rounded-2xl text-left transition-all"
                  style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)' }}
                >
                  <span
                    className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-[13px] font-bold"
                    style={{ background: 'linear-gradient(135deg,var(--gold-600),var(--gold-300))', color: '#1a1206', letterSpacing: '0.02em' }}
                  >
                    {t.word.slice(0, 2)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="text-[14px] font-bold tracking-[0.12em]" style={{ color: 'var(--text)' }}>{t.word}</span>
                      <span className="font-mono text-[11px]" style={{ color: 'var(--gold-300)', letterSpacing: '0.1em' }}>{t.morse_pretty}</span>
                    </span>
                    <span className="block text-[10.5px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                      {t.style_label} · {t.sub}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-[13px]" style={{ color: 'var(--gold-300)' }}>▶</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Word input */}
        <div>
          <label className="text-[9.5px] block mb-1 tracking-[0.24em] uppercase font-medium" style={{ color: 'var(--text-muted)' }}>
            你的词
          </label>
          <input
            type="text"
            value={word}
            onChange={e => setWord(e.target.value)}
            placeholder="love/hate/horse"
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
              <span>{genStage ? `${genStage}…` : '生成中…'}</span>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" strokeWidth={2.4} />
              <span>生成我的歌</span>
            </>
          )}
        </button>

        {/* 生成进度条（异步任务）：让用户看到 编码→动机→编曲→AI→对齐混音 的阶段推进 */}
        {isGenerating && (
          <div className="w-full" role="progressbar" aria-valuenow={genProgress} aria-valuemin={0} aria-valuemax={100}>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(201,162,74,0.15)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(3, genProgress)}%`,
                  background: 'linear-gradient(90deg,#C9A24A,#F2D27A)',
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <p className="text-center text-[10px] mt-1 tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {genProgress}% · {genStage || '处理中'}
            </p>
          </div>
        )}

        {/* 试听摩斯动机（零延迟 Web Audio 预览，不消耗生成额度）：先听旋律再决定生成 */}
        {!isGenerating && (
          <button
            type="button"
            onClick={() => (previewPlaying ? stopPreview() : playPreview())}
            disabled={!word.trim()}
            className="btn-tactile w-full py-2 rounded-full text-[12px] tracking-[0.14em] flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: 'rgba(201,162,74,0.10)', border: '1px solid rgba(201,162,74,0.30)', color: 'var(--gold-100)' }}
          >
            {previewPlaying ? '■ 停止试听' : '▶ 试听摩斯动机（免生成）'}
          </button>
        )}

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

        {/* 快捷灵感词 —— 点选即填充输入框，降低上手门槛 */}
        <div className="pt-1">
          <p className="text-[9.5px] mb-2 tracking-[0.24em] uppercase font-medium" style={{ color: 'var(--text-muted)' }}>
            没有头绪？试试这些
          </p>
          <div className="flex flex-wrap gap-2">
            {['love', 'hate', 'horse', 'star', 'gold', 'sos', 'free', 'home'].map(w => (
              <button
                key={w}
                type="button"
                onClick={() => { haptic(4); setWord(w); setStatus(''); setStatusKind(''); }}
                className="chip-suggest btn-tactile px-3 py-1.5 text-[12px] tracking-wide"
                style={word.toLowerCase() === w ? { background: 'rgba(201,162,74,0.14)', borderColor: 'rgba(201,162,74,0.45)', color: 'var(--gold-100)' } : undefined}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* 品牌律动 —— 声波律动条，填充留白并呼应「声印」主题 */}
        <div className="flex-1 flex flex-col items-center justify-end pt-6 pb-1 pointer-events-none select-none" aria-hidden="true">
          <div className="flex items-end justify-center gap-[3px]" style={{ height: 34 }}>
            {[0.5, 0.8, 0.35, 1, 0.6, 0.9, 0.45, 0.75, 0.55, 1, 0.4, 0.7, 0.85, 0.5].map((h, i) => (
              <span
                key={i}
                className="eq-bar"
                style={{ height: `${Math.round(h * 34)}px`, animationDelay: `${i * 0.09}s`, animationDuration: `${1.1 + (i % 4) * 0.22}s` }}
              />
            ))}
          </div>
          <p className="text-[10px] mt-3 tracking-[0.28em] uppercase" style={{ color: 'var(--text-faint)' }}>
            把心事，谱成一段只有你懂的旋律
          </p>
        </div>
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
                    src={albumArtSrcFull}
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
                            color: i < displayLetterIdx ? 'rgba(242,239,232,0.78)' : i === displayLetterIdx ? 'var(--gold-100)' : 'rgba(242,239,232,0.08)',
                          transform: i < displayLetterIdx ? 'translateY(0)' : i === displayLetterIdx ? 'translateY(-2px) scale(1.06)' : 'translateY(4px)',
                            textShadow: i === displayLetterIdx ? '0 0 18px rgba(201,162,74,0.4)' : 'none',
                        }}
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                  )}
                </div>

                {/* morse animated — 前奏延迟期内保持静止 */}
                <div className="text-center mb-2.5" style={{ fontFamily: 'var(--font-mono)', minHeight: '1.35em' }}>
                  <div className="flex justify-center items-center gap-3" style={{ opacity: currentTime * 1000 > introMs ? 0.32 : 0.88 }}>
                    {introAnimReady && morseSpans?.map(({ ch, eff, delay, key }) => {
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

                <div className="flex items-center justify-center gap-5">
                  {/* 收藏按钮 */}
                  <button
                    type="button"
                    aria-label={isSaved ? '取消收藏' : '收藏'}
                    onClick={handleToggleSave}
                    className="btn-icon btn-tactile w-10 h-10 rounded-full flex items-center justify-center"
                    style={isSaved ? { color: '#f97316', borderColor: 'rgba(249,115,22,0.4)' } : undefined}
                  >
                    <Heart className={`w-4 h-4 ${isSaved ? 'fill-[#f97316]' : ''}`} />
                  </button>

                  {/* 播放 / 暂停 */}
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

                  {/* 更多菜单 */}
                  <button
                    type="button"
                    aria-label="更多操作"
                    onClick={() => { haptic(4); setShowSongMenu(true); }}
                    className="btn-icon btn-tactile w-10 h-10 rounded-full flex items-center justify-center"
                  >
                    <MoreHorizontal className="w-4 h-4" />
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

      {/* 歌曲菜单弹层 */}
      {showSongMenu && result && (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end sheet-backdrop"
          style={{ background: 'rgba(8,7,9,0.70)', backdropFilter: 'blur(6px)' }}
          onClick={() => setShowSongMenu(false)}
        >
          <div
            className="rounded-t-[28px] px-4 pt-4 pb-8 sheet-panel"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderBottom: 'none' }}
            onClick={e => e.stopPropagation()}
          >
            {/* 拖动指示条 */}
            <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: 'var(--border)' }} aria-hidden="true" />
            {/* 曲目信息 */}
            <div className="flex items-center gap-3 mb-4 pb-3"
                 style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0"
                   style={{ border: '1px solid rgba(201,162,74,0.3)' }}>
                <img src={albumArtSrcFull}
                     alt="" className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
                  {(result.word || '').toUpperCase()}
                </p>
                <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {result.style_label || '声印'}
                </p>
              </div>
              <button type="button" onClick={() => setShowSongMenu(false)}
                      className="ml-auto btn-icon w-8 h-8 flex-shrink-0"
                      style={{ color: 'var(--text-muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 操作列表 */}
            <div className="space-y-1">
              {/* 下载 */}
              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloading}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-colors row-tappable"
                style={{ background: 'var(--surface-sunken)', opacity: isDownloading ? 0.6 : 1 }}
              >
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                     style={{ background: 'rgba(99,182,255,0.12)', border: '1px solid rgba(99,182,255,0.25)' }}>
                  <Download className="w-4 h-4" style={{ color: '#63b6ff' }} />
                </div>
                <div className="text-left">
                  <p className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>
                    {isDownloading ? '下载中…' : '下载 MP3'}
                  </p>
                  <p className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>保存到本机相册 / 文件</p>
                </div>
              </button>

              {/* 收藏 */}
              <button
                type="button"
                onClick={handleToggleSave}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-colors row-tappable"
                style={{ background: 'var(--surface-sunken)' }}
              >
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                     style={{
                       background: isSaved ? 'rgba(249,115,22,0.12)' : 'rgba(255,255,255,0.06)',
                       border: isSaved ? '1px solid rgba(249,115,22,0.35)' : '1px solid var(--border-subtle)',
                     }}>
                  <Heart className={`w-4 h-4 ${isSaved ? 'fill-[#f97316]' : ''}`}
                         style={{ color: isSaved ? '#f97316' : 'var(--text-muted)' }} />
                </div>
                <div className="text-left">
                  <p className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>
                    {isSaved ? '取消收藏' : '收藏这首歌'}
                  </p>
                  <p className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                    {isSaved ? '从收藏列表中移除' : `已保存 ${savedTracks.length} 首 · 存于本机`}
                  </p>
                </div>
                {isSaved && (
                  <Check className="w-4 h-4 ml-auto flex-shrink-0" style={{ color: '#f97316' }} />
                )}
              </button>

              {/* 分享（占位，后续可接系统分享） */}
              <button
                type="button"
                onClick={() => {
                  haptic(4);
                  setShowSongMenu(false);
                  try {
                    if (navigator.share) {
                      navigator.share({ title: (result.word || '').toUpperCase() + ' · 声印', text: '用摩斯码生成的音乐' });
                    }
                  } catch (_) {}
                }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-colors row-tappable"
                style={{ background: 'var(--surface-sunken)' }}
              >
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                     style={{ background: 'rgba(167,243,208,0.10)', border: '1px solid rgba(167,243,208,0.22)' }}>
                  <Share2 className="w-4 h-4" style={{ color: '#a7f3d0' }} />
                </div>
                <div className="text-left">
                  <p className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>分享</p>
                  <p className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>通过系统分享给朋友</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 我的收藏面板 */}
      {showFavorites && (
        <div
          className="absolute inset-0 z-50 flex flex-col justify-end sheet-backdrop"
          style={{ background: 'rgba(8,7,9,0.72)', backdropFilter: 'blur(6px)' }}
          onClick={() => setShowFavorites(false)}
        >
          <div
            className="rounded-t-[28px] px-4 pt-4 pb-8 flex flex-col sheet-panel"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-subtle)',
                     borderBottom: 'none', maxHeight: '78%' }}
            onClick={e => e.stopPropagation()}
          >
            {/* 拖动指示条 */}
            <div className="mx-auto mb-3 h-1 w-10 rounded-full flex-shrink-0" style={{ background: 'var(--border)' }} aria-hidden="true" />
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Heart className="w-4 h-4 fill-[#f97316]" style={{ color: '#f97316' }} />
                <span className="text-[13px] font-semibold tracking-[0.10em]"
                      style={{ color: 'var(--gold-100)', fontFamily: 'var(--font-display)' }}>
                  我的收藏
                </span>
                {savedTracks.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(249,115,22,0.12)', color: '#f97316',
                                 border: '1px solid rgba(249,115,22,0.25)' }}>
                    {savedTracks.length} 首
                  </span>
                )}
              </div>
              <button type="button" onClick={() => setShowFavorites(false)}
                      className="btn-icon w-8 h-8 flex items-center justify-center rounded-full"
                      style={{ color: 'var(--text-muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 列表 */}
            <div className="overflow-y-auto flex-1 -mx-1 px-1">
              {savedTracks.length === 0 ? (
                <div className="py-12 flex flex-col items-center gap-2">
                  <Heart className="w-8 h-8 opacity-20" style={{ color: 'var(--text-muted)' }} />
                  <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    还没有收藏，点击心形按钮收藏喜欢的歌曲
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 pb-2">
                  {[...savedTracks].reverse().map((track, i) => {
                    const isCurrentPlaying = result?.audio_url === track.audio_url && isPlaying;
                    const isCurrent        = result?.audio_url === track.audio_url;
                    const date = track.savedAt
                      ? new Date(track.savedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
                      : '';
                    return (
                      <div key={track.audio_url + i}
                           className="flex items-center gap-3 px-3 py-2.5 rounded-2xl row-tappable"
                           style={{
                             background: isCurrent
                               ? 'linear-gradient(135deg,rgba(249,115,22,0.10) 0%,rgba(201,162,74,0.06) 100%)'
                               : 'var(--surface-sunken)',
                             border: isCurrent
                               ? '1px solid rgba(249,115,22,0.28)'
                               : '1px solid var(--border-subtle)',
                           }}>
                        {/* 序号 / 播放指示 */}
                        <div className="w-5 flex-shrink-0 flex items-center justify-center">
                          {isCurrentPlaying
                            ? <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#f97316' }} />
                            : <span className="text-[11px] font-mono" style={{ color: 'var(--text-faint)' }}>
                                {savedTracks.length - i}
                              </span>
                          }
                        </div>

                        {/* 歌曲信息 */}
                        <div className="flex-1 min-w-0 cursor-pointer"
                             onClick={() => handlePlayFromFavorites(track)}>
                          <p className="text-[13px] font-semibold truncate"
                             style={{ color: isCurrent ? 'var(--gold-100)' : 'var(--text)',
                                      fontFamily: 'var(--font-display)' }}>
                            {(track.word || '声印').toUpperCase()}
                          </p>
                          <p className="text-[10.5px] mt-0.5 flex items-center gap-1.5"
                             style={{ color: 'var(--text-muted)' }}>
                            <span>{track.style_label || '声印'}</span>
                            {date && <><span style={{ opacity: 0.35 }}>·</span><span>{date}</span></>}
                          </p>
                        </div>

                        {/* 播放按钮 */}
                        <button type="button"
                                aria-label="播放"
                                onClick={() => handlePlayFromFavorites(track)}
                                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                                style={{
                                  background: isCurrent
                                    ? 'rgba(249,115,22,0.18)'
                                    : 'rgba(201,162,74,0.10)',
                                  border: isCurrent
                                    ? '1px solid rgba(249,115,22,0.35)'
                                    : '1px solid rgba(201,162,74,0.20)',
                                }}>
                          <Play className="w-3.5 h-3.5 ml-0.5"
                                style={{ color: isCurrent ? '#f97316' : 'var(--gold-300)' }} />
                        </button>

                        {/* 移除收藏 */}
                        <button type="button"
                                aria-label="移除收藏"
                                onClick={() => handleRemoveFromFavorites(track.audio_url)}
                                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                                style={{ color: 'var(--text-faint)' }}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
