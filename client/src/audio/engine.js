// Web Audio APIによる音声合成エンジンの土台。
// 外部音声アセットは一切使わず、オシレーター/ノイズ/フィルタのみで音を作る。
// ノードグラフ: masterGain -> (bgmGain, sfxGain) -> destination
import { getSettings } from "../storage.js";

let ctx = null;
let masterGain = null;
let bgmGain = null;
let sfxGain = null;
let unlocked = false;

function ensureContext() {
  if (ctx) return ctx;
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  ctx = new AC();
  masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);
  bgmGain = ctx.createGain();
  bgmGain.connect(masterGain);
  sfxGain = ctx.createGain();
  sfxGain.connect(masterGain);
  const s = getSettings();
  setBgmVolume(s.bgmVolume);
  setSfxVolume(s.seVolume);
  return ctx;
}

export function getContext() {
  return ensureContext();
}
export function getBgmGain() {
  ensureContext();
  return bgmGain;
}
export function getSfxGain() {
  ensureContext();
  return sfxGain;
}

export function setBgmVolume(v) {
  if (bgmGain) bgmGain.gain.value = Math.max(0, Math.min(1, v / 100));
}
export function setSfxVolume(v) {
  if (sfxGain) sfxGain.gain.value = Math.max(0, Math.min(1, v / 100));
}

// ブラウザの自動再生ポリシー対策：初回のユーザー操作でAudioContextを生成/resumeする。
// {once:true}でリスナー自体は1回で自動的に外れる。
export function initAudioUnlockOnFirstGesture(onUnlock) {
  if (typeof window === "undefined" || unlocked) return;
  const handler = () => {
    if (unlocked) return;
    unlocked = true;
    const c = ensureContext();
    if (c && c.state === "suspended") c.resume();
    onUnlock?.();
  };
  window.addEventListener("pointerdown", handler, { once: true });
  window.addEventListener("keydown", handler, { once: true });
}

// 触覚フィードバック（モバイル振動）。設定でON/OFF可能。意味のある節目（勝敗確定等）にのみ使い、
// ボタン操作全般には使わない（常に鳴らすと、節目の合図として働かなくなる）。
export function triggerHaptic(pattern = 15) {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  if (!getSettings().haptics) return;
  navigator.vibrate(pattern);
}

// タブがバックグラウンドに回ったら合成音声も一時停止する（web.dev: Developing game audio準拠）
export function initVisibilityPause() {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend?.();
    else if (unlocked) ctx.resume?.();
  });
}
