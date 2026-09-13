// 効果音（SFX）合成関数群。ZzFX的に「オシレーター/ノイズ＋ADSR風エンベロープ」だけで完結させる。
import { getContext, getSfxGain } from "./engine.js";

function tone({ freq, duration, type = "sine", attack = 0.005, release = 0.08, gain = 0.22, freqEnd }) {
  const ctx = getContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, freq), t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + release);
  osc.connect(g);
  g.connect(getSfxGain());
  osc.start(t0);
  osc.stop(t0 + duration + release + 0.02);
}

function noiseBurst({ duration = 0.15, gain = 0.18, filterFreq = 2200, filterType = "bandpass" }) {
  const ctx = getContext();
  if (!ctx) return;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filt = ctx.createBiquadFilter();
  filt.type = filterType;
  filt.frequency.value = filterFreq;
  const g = ctx.createGain();
  const t0 = ctx.currentTime;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filt);
  filt.connect(g);
  g.connect(getSfxGain());
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

export function playClick() {
  tone({ freq: 720, duration: 0.04, type: "square", gain: 0.1, release: 0.03 });
}
export function playCardFlip() {
  noiseBurst({ duration: 0.16, gain: 0.15, filterFreq: 3200, filterType: "bandpass" });
}
export function playTick() {
  tone({ freq: 1000, duration: 0.03, type: "square", gain: 0.07, release: 0.02 });
}
export function playNotify() {
  tone({ freq: 880, duration: 0.09, type: "sine", gain: 0.18, freqEnd: 1200, release: 0.1 });
}
export function playCoin() {
  tone({ freq: 660, duration: 0.06, type: "sine", gain: 0.2, release: 0.05 });
  setTimeout(() => tone({ freq: 880, duration: 0.08, type: "sine", gain: 0.2, release: 0.06 }), 55);
}

// 連勝streakに応じて半音刻み(1.06^streak, 上限6)でピッチを上げる（research推奨のピッチシフト手法）
export function playWin(streak = 0) {
  const pitch = Math.pow(1.06, Math.min(streak, 6));
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((n, i) => {
    setTimeout(() => tone({ freq: n * pitch, duration: 0.15, type: "triangle", gain: 0.19, release: 0.12 }), i * 65);
  });
}
export function playLose() {
  tone({ freq: 300, duration: 0.3, type: "sawtooth", gain: 0.16, freqEnd: 110, release: 0.15 });
}

// ─── ベットループ専用SE：KING/JOKER選択・レイズ/コール/フォールド ───
// 従来はどの操作も.kj-pressableの汎用クリック音(playClick)しか鳴らず、対戦の核であるベット
// ループの緊張感が音では一切表現できていなかった（批判的レビューで指摘・対応）。

// KING/JOKER選択：払い出し方向を決める重要な決断の瞬間。playSelectより低く・芯のある1音にする。
export function playKjChoice() {
  tone({ freq: 440, duration: 0.09, type: "triangle", gain: 0.2, freqEnd: 550, release: 0.08 });
}

// レイズ：チップを積み増す緊張感を、上昇する2音の重ねで表現する。
export function playRaise() {
  tone({ freq: 392, duration: 0.07, type: "square", gain: 0.14, release: 0.05 });
  setTimeout(() => tone({ freq: 523.25, duration: 0.09, type: "square", gain: 0.16, release: 0.07 }), 60);
}

// コール/チェック：静かな追従。レイズより控えめな単音のクリック。
export function playCall() {
  tone({ freq: 330, duration: 0.05, type: "sine", gain: 0.13, release: 0.05 });
}

// フォールド：撤退の脱力感。playLoseほど悲劇的にはせず、短く沈む1音に留める
// （フォールドは戦術的撤退であり必ずしも「負け」の感情演出をフルにする場面ではないため）。
export function playFold() {
  tone({ freq: 260, duration: 0.16, type: "sine", gain: 0.13, freqEnd: 160, release: 0.12 });
}






// カードシューから1枚押し出される音（「プシュッ」）。
// **短い空気の抜けと、紙が擦れる音の2層で作る。** 単発のノイズバーストだけだと「サッ」という
// 布擦れにしかならず、機械が押し出した感じが出ない——低い方の抜け（ローパスの短い息）が
// 機械側、高い方の帯（ハイパス）がカードの縁が滑る音を担う。
// 音量は控えめ。**1局に2回鳴る**ので、クリック音より目立つと配るたびに耳につく。
export function playDispense() {
  noiseBurst({ duration: 0.09, gain: 0.13, filterFreq: 900, filterType: "lowpass" });
  noiseBurst({ duration: 0.13, gain: 0.07, filterFreq: 4200, filterType: "highpass" });
}

// ロビーの灯りが入る音（入場の演出でペンダント灯が点く瞬間。LobbyScreen.jsx の LOBBY_INTRO.lamp）。
// 低い芯の1音（電源が入る手応え）に、上の2音の響き（灯りが部屋に広がる）を少しずつずらして重ねる。
// BGMの上に乗るので音量は控えめにし、響きは長めの余韻で消す。
export function playLobbyLights() {
  tone({ freq: 196, duration: 0.18, type: "sine", gain: 0.12, release: 0.3 });
  setTimeout(() => tone({ freq: 587.33, duration: 0.12, type: "triangle", gain: 0.07, release: 0.45 }), 70);
  setTimeout(() => tone({ freq: 880, duration: 0.1, type: "sine", gain: 0.05, release: 0.6 }), 150);
}

// PLAY を押して卓へ潜る音（LobbyScreen.jsx）。息を吸うように上がる1音に、短い風切りを重ねる。
export function playLobbyDive() {
  tone({ freq: 160, freqEnd: 480, duration: 0.5, type: "sine", gain: 0.1, release: 0.15 });
  noiseBurst({ duration: 0.4, gain: 0.05, filterFreq: 1400, filterType: "bandpass" });
}

// メニューを切り替えた音（ナビのボタン）。
// **汎用のクリック音より低く短く**する——画面が丸ごと入れ替わる操作なので、押した手応え(playClick)と
// 同じ音だと「押した」のか「移った」のかが音から区別できない。2音を軽く重ねて「移った」を出す。
export function playTabSwitch() {
  tone({ freq: 392, duration: 0.05, type: "triangle", gain: 0.11, release: 0.05 });
  setTimeout(() => tone({ freq: 587.33, duration: 0.07, type: "sine", gain: 0.09, release: 0.07 }), 45);
}

// 報酬ボックスの蓋が開く音（screens/ShopScreen.jsx）。
// **低い軋み（蓋そのもの）と、漏れ出す光の高い響きの2層をずらして重ねる**——同時に出すと
// 1つの雑音に潰れて「閉じていた物が開いた」という順序が音から消える。
// めくった瞬間の音（playRewardRevealCue）とは別の拍なので、ここは開く所だけを担う。
export function playBoxOpen() {
  noiseBurst({ duration: 0.16, gain: 0.1, filterFreq: 700, filterType: "lowpass" });
  setTimeout(() => tone({ freq: 294, freqEnd: 622, duration: 0.44, type: "sine", gain: 0.1, release: 0.24 }), 90);
}

// ロード画面でディーラーが札を切る音。紙の擦れを短く3回刻む（多いと1つの雑音に潰れる）。
export function playShuffle() {
  [0, 70, 140].forEach((ms) => setTimeout(
    () => noiseBurst({ duration: 0.07, gain: 0.08, filterFreq: 3600, filterType: "bandpass" }), ms,
  ));
}
