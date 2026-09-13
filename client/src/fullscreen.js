// 全画面表示。
//
// **読み込み時に自動で全画面へ入ることはできない。** `requestFullscreen()` はユーザーの操作
// （クリック／キー）から直接呼ばれたときしか通らず、load や useEffect から呼ぶと必ず弾かれる
// ——全ブラウザ共通の仕様で、回避策は無い。**「自動で」を実装しようとしないこと。**
//
// このゲームはタイトル画面を押して入る作りなので、**その1回のクリックに相乗りする**のが
// 「開いたら全画面」にいちばん近い形になる。押した瞬間に同期で呼ぶこと——`setTimeout` の中や
// `onEnter` 側へ移すと、その時点では操作の有効期限（transient activation）が切れていて
// **無言で失敗する**（例外も警告も出ないので、動かない理由が画面からもコンソールからも読めない）。
//
// **入れない環境がある。** iPhone の Safari は Fullscreen API を持たず、iframe に埋め込まれた
// 場合も `allow="fullscreen"` が無ければ拒否される。どちらも**失敗して何も起きないだけ**にして、
// 全画面に入れない環境でも今まで通り遊べる状態を保つ。

const root = () => document.documentElement;

// この環境で全画面に入れるか。**入れないなら設定のトグル自体を出さないこと**
// ——押しても永久に何も起きないスイッチは、画面に出ている嘘になる。
export function isFullscreenSupported() {
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

// Promise を返す実装（標準）と返さない実装（旧webkit）の両方があるので、どちらでも黙って畳む。
function settle(r) {
  if (r && typeof r.catch === "function") r.catch(() => {});
}

export function enterFullscreen() {
  if (isFullscreen()) return;
  const e = root();
  const req = e.requestFullscreen || e.webkitRequestFullscreen;
  if (!req) return;
  // navigationUI:"hide" はブラウザのUIを引っ込める要望（拒否されても全画面自体は通る）。
  try { settle(req.call(e, { navigationUI: "hide" })); } catch { /* 許可されない場面 */ }
}

export function exitFullscreen() {
  if (!isFullscreen()) return;
  const ex = document.exitFullscreen || document.webkitExitFullscreen;
  if (!ex) return;
  try { settle(ex.call(document)); } catch { /* 同上 */ }
}

// 全画面の出入りを監視する。**Esc で抜けたときも必ず通る**ので、設定のトグルの表示と
// 実際の状態が食い違わない（トグルが実態と違う値を出していると、それも嘘のスイッチになる）。
export function onFullscreenChange(fn) {
  document.addEventListener("fullscreenchange", fn);
  document.addEventListener("webkitfullscreenchange", fn);
  return () => {
    document.removeEventListener("fullscreenchange", fn);
    document.removeEventListener("webkitfullscreenchange", fn);
  };
}
