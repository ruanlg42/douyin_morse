import React, {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import { LETTER_GLYPHS } from './letterGlyphs.js';
import { startMorseTone, stopMorseTone } from './morseAudio.js';

/* ---------- 时序 ---------- */
const UNIT_MS = 240;
const symMs = (sym) => (sym === '-' ? UNIT_MS * 3 : UNIT_MS);
const GAP_MS = UNIT_MS;
const READ_DELAY_MS = 320;
const DASH_LEN_CAP = 34;

/**
 * 「划」的路径：优先用视频提取的折线 pts（贴合弧形笔画，如 C/G/O/S），
 * 否则退回中心+角度+长度的直线段。
 * 坐标来自字母动画视频末帧（letterGlyphs.js），落在字母的记忆位置上。
 */
const buildDashPoints = (m) => {
  if (Array.isArray(m.pts) && m.pts.length >= 2) {
    return m.pts
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`)
      .join('');
  }
  const half = Math.min(m.len || 20, DASH_LEN_CAP) / 2;
  const rad = ((m.angle || 0) * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const x1 = (m.cx - ux * half).toFixed(2);
  const y1 = (m.cy - uy * half).toFixed(2);
  const x2 = (m.cx + ux * half).toFixed(2);
  const y2 = (m.cy + uy * half).toFixed(2);
  return `M${x1},${y1}L${x2},${y2}`;
};

/**
 * 象形记忆摩斯字母：字形底图与点/划标记均来自同一段字母动画视频末帧
 * （幽灵底图 public/letter-glyph/<L>.png + letterGlyphs.js 标记坐标），
 * 因此点划必然落在字母的记忆位置上（A 顶点+横梁 / B 左脊+三凸点…）。
 * 默认静态展示；点播放键后才动画朗读。
 */
const MorseLetterAnim = forwardRef(function MorseLetterAnim(
  { letter, soundOn = true, autoPlay = false, onPlayingChange, onEnded },
  ref,
) {
  const glyph = LETTER_GLYPHS[letter];
  const morse = glyph?.morse || '';
  const vbH = useMemo(() => {
    const vb = glyph?.viewBox || '0 0 100 120';
    const parts = vb.trim().split(/\s+/);
    return Number(parts[3]) || 120;
  }, [glyph]);
  // 幽灵底图与标记同源同坐标系（viewBox 0 0 100 vbH），铺满即对齐
  // v 参数用于在重新生成字形 PNG 后强制刷新浏览器缓存
  const ghostSrc = `${import.meta.env.BASE_URL || '/'}letter-glyph/${letter}.png?v=2`;

  const elements = useMemo(() => {
    if (!glyph?.markers?.length) return [];
    return glyph.markers.map((m, posInSeq) => {
      const sym = morse[posInSeq] || (m.type === 'dash' ? '-' : '.');
      if (m.type === 'dot') {
        return { sym, kind: 'dot', cx: m.cx, cy: m.cy, r: m.r || 4.4, posInSeq };
      }
      return {
        sym,
        kind: 'dash',
        cx: m.cx,
        cy: m.cy,
        thick: Math.min(m.thick || 6, 15),
        points: buildDashPoints(m),
        posInSeq,
      };
    });
  }, [glyph, morse]);

  const [builtCount, setBuiltCount] = useState(0);
  const [activeEl, setActiveEl] = useState(-1);

  const runIdRef = useRef(0);
  const timersRef = useRef([]);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    stopMorseTone();
  };
  const schedule = (fn, ms) => { timersRef.current.push(setTimeout(fn, ms)); };

  const runSequence = () => {
    clearTimers();
    const runId = ++runIdRef.current;
    setBuiltCount(0);
    setActiveEl(-1);

    if (!elements.length) {
      onPlayingChange?.(false);
      onEnded?.();
      return;
    }
    onPlayingChange?.(true);

    const stagger = Math.min(120, Math.max(60, 480 / elements.length));
    elements.forEach((_, i) => {
      schedule(() => {
        if (runIdRef.current !== runId) return;
        setBuiltCount(i + 1);
      }, 60 + i * stagger);
    });

    let t = 60 + elements.length * stagger + READ_DELAY_MS;
    elements.forEach((el, k) => {
      schedule(() => {
        if (runIdRef.current !== runId) return;
        setActiveEl(k);
        if (soundOn) startMorseTone();
      }, t);
      t += symMs(el.sym);
      schedule(() => {
        if (runIdRef.current !== runId) return;
        if (soundOn) stopMorseTone();
        setActiveEl(-1);
      }, t);
      if (k < elements.length - 1) t += GAP_MS;
    });

    schedule(() => {
      if (runIdRef.current !== runId) return;
      onPlayingChange?.(false);
      onEnded?.();
    }, t + 160);
  };

  const showStatic = () => {
    runIdRef.current++;
    clearTimers();
    setBuiltCount(elements.length);
    setActiveEl(-1);
    onPlayingChange?.(false);
  };

  useImperativeHandle(ref, () => ({
    restart: () => runSequence(),
    pause: () => {
      runIdRef.current++;
      clearTimers();
      setActiveEl(-1);
      onPlayingChange?.(false);
    },
    showStatic,
  }));

  useEffect(() => {
    if (!elements.length) return;
    if (autoPlay) {
      runSequence();
    } else {
      showStatic();
    }
    return () => { runIdRef.current++; clearTimers(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, autoPlay]);

  const glowId = `mlGlow-${letter}`;

  return (
    <div className="morse-letter-stage" aria-label={`字母 ${letter} 摩斯动画`}>
      <svg viewBox={`0 0 100 ${vbH}`} className="morse-letter-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id={glowId} x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 幽灵底图：与标记同源的字母剪影，铺满 viewBox */}
        <image
          href={ghostSrc}
          x="0"
          y="0"
          width="100"
          height={vbH}
          preserveAspectRatio="xMidYMid meet"
        />

        {elements.slice(0, builtCount).map((m, i) => {
          const active = i === activeEl;
          const color = active ? '#fff3c4' : '#f6d98a';
          const cls = `morse-el${active ? ' is-active' : ''}`;
          if (m.kind === 'dot') {
            return (
              <circle
                key={`el-${letter}-${i}`}
                className={cls}
                cx={m.cx}
                cy={m.cy}
                r={active ? m.r + 1.6 : m.r}
                fill={color}
                filter={active ? `url(#${glowId})` : undefined}
              />
            );
          }
          return (
            <path
              key={`el-${letter}-${i}`}
              className={cls}
              d={m.points}
              fill="none"
              stroke={color}
              strokeWidth={active ? m.thick + 2.5 : m.thick}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={active ? `url(#${glowId})` : undefined}
            />
          );
        })}
      </svg>
    </div>
  );
});

export default MorseLetterAnim;
