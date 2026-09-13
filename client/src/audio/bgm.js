// 生成的アンビエントBGM（Web Audio API で合成。音声ファイルは使わない）。
// 作曲済みの1曲ではなく、ローパスドローン+低速LFO+散発的な単音を都度ランダムに鳴らし続ける方式。
// 決め打ちループがないため、長めのプレイセッションでも耳が飽きにくい。
import { getContext, getBgmGain } from "./engine.js";

let nodes = null;
let noteTimer = null;
let pulseTimer = null;
let currentVariant = null;
// いま鳴らしている variant の譜面撒き（タブ復帰時に撒き直すために覚えておく）。
let loops = null;
let visibilityBound = false;

// **タブが隠れている間は譜面を撒かない**。別タブから戻ったときに、
// 隠れていた間の音がまとめて鳴るのを防ぐ。
//
// 原因は engine.js の initVisibilityPause と この撒き方の噛み合わせ:
// 隠れると AudioContext を suspend するが、**scheduleNote は setTimeout＝実時間で回り続ける**。
// suspend 中は `ctx.currentTime` が凍るので、裏で積まれた音が全部**同じ開始時刻**を持ち、
// resume した瞬間に一斉に鳴る（隠れていた時間が長いほど重なる）。
// 止めるべきなのは音ではなく**撒く側**なので、タイマーを畳んで復帰時に撒き直す。
function bindVisibility() {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (noteTimer) clearTimeout(noteTimer);
      if (pulseTimer) clearTimeout(pulseTimer);
      noteTimer = null;
      pulseTimer = null;
      return;
    }
    // 復帰。鳴らしている最中だった時だけ撒き直す（stopBgm 済みなら何もしない）。
    if (!nodes || !loops) return;
    if (!noteTimer) loops.note?.();
    if (!pulseTimer) loops.pulse?.();
  });
}

const SCALES = {
  lobby: [220, 246.94, 261.63, 293.66, 329.63, 392.0],
  battle: [196.0, 220.0, 233.08, 261.63, 293.66, 311.13],
};

// variantを切り替える場合は一度停止して再構築する（対戦中(battle)とロビー(lobby)で
// 明確に違う曲調にするため、これまで実質lobbyしか鳴っていなかった問題を解消する）。
export function startBgm(variant = "lobby") {
  const ctx = getContext();
  if (!ctx) return;
  if (nodes && currentVariant === variant) return;
  if (nodes) stopBgm();
  currentVariant = variant;

  const drone = ctx.createOscillator();
  drone.type = "sine";
  drone.frequency.value = variant === "battle" ? 98 : 110;

  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 380;

  const lfo = ctx.createOscillator();
  lfo.frequency.value = variant === "battle" ? 0.26 : 0.12;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = variant === "battle" ? 220 : 140;
  lfo.connect(lfoGain);
  lfoGain.connect(filt.frequency);

  const droneGain = ctx.createGain();
  droneGain.gain.value = variant === "battle" ? 0.055 : 0.045;
  drone.connect(filt);
  filt.connect(droneGain);
  droneGain.connect(getBgmGain());
  drone.start();
  lfo.start();
  nodes = { drone, lfo, filt, droneGain };

  const scale = SCALES[variant] || SCALES.lobby;
  const isBattle = variant === "battle";
  const scheduleNote = () => {
    // 隠れている間は鳴らさないし、次も撒かない（凍った currentTime に積み上がるのを防ぐ）。
    if (!nodes || (typeof document !== "undefined" && document.hidden)) return;
    const freq = scale[Math.floor(Math.random() * scale.length)];
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(isBattle ? 0.065 : 0.05, t0 + (isBattle ? 0.5 : 1.2));
    g.gain.linearRampToValueAtTime(0.0001, t0 + (isBattle ? 2.0 : 3.4));
    osc.connect(g);
    g.connect(getBgmGain());
    osc.start(t0);
    osc.stop(t0 + (isBattle ? 2.2 : 3.6));
    noteTimer = setTimeout(scheduleNote, isBattle ? 700 + Math.random() * 900 : 1800 + Math.random() * 2600);
  };
  scheduleNote();

  // battleのみ: 緊張感を出す低音の鼓動パルス（一定間隔のノイズレス低域トーン）
  if (isBattle) {
    const schedulePulse = () => {
      if (!nodes || (typeof document !== "undefined" && document.hidden)) return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 62;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.09, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      osc.connect(g);
      g.connect(getBgmGain());
      osc.start(t0);
      osc.stop(t0 + 0.55);
      pulseTimer = setTimeout(schedulePulse, 1100);
    };
    loops = { note: scheduleNote, pulse: schedulePulse };
    schedulePulse();
  } else {
    loops = { note: scheduleNote, pulse: null };
  }
  bindVisibility();
}

export function stopBgm() {
  if (noteTimer) clearTimeout(noteTimer);
  if (pulseTimer) clearTimeout(pulseTimer);
  noteTimer = null;
  pulseTimer = null;
  currentVariant = null;
  loops = null;
  if (nodes) {
    try {
      nodes.drone.stop();
      nodes.lfo.stop();
    } catch {
      // 既に停止済みの場合は無視
    }
    nodes = null;
  }
}
