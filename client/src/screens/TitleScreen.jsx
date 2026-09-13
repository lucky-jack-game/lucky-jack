import { useState, useEffect } from "react";
import { FONT, GILT } from "../shared.jsx";
import { getSettings } from "../storage.js";
import { enterFullscreen } from "../fullscreen.js";
import { prefetchLobby3D } from "../LobbyArt.jsx";


// ファサード中央に掲げる銘板（タイトルロックアップ）。
// ファサードの銘板。旧`MarqueeTitle`は電飾看板風に明滅していたが（marqueeFlicker）、それは
// ラスベガスのネオンの語彙であってリゾートホテルの品ではないため、明滅を止めて金箔の箔押し／
// 彫り込みに変えた（グラデーションの背景を文字でクリップし、drop-shadowで彫りの陰を付ける。
// 詳細はindex.cssの.kj-facade-wordmark）。上下に繰形(コーニス)を渡して中央軸を示す。
// large: タイトル画面用の一回り大きい組み（同じ意匠のまま寸法だけ変える。
// ホームからロゴを外した現在、この銘板を使うのはタイトル画面だけ）。
function FacadeWordmark({ large = false }) {
  const cornice = (
    <div className="kj-cornice"><div className="kj-cornice-gem" /></div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: large ? 13 : 9, width: "100%" }}>
      {cornice}
      <div className={`kj-facade-wordmark${large ? " kj-title-wordmark" : ""}`}>LUCKY JACK</div>
      {cornice}
    </div>
  );
}

// ─── タイトル画面 ─────────────────────────────────────────
// サイトを開いた最初の一枚。
// 新しい意匠は作らず、ホーム(ファサード)の建材——夜空・アップライト・紋章・箔押しの銘板・繰形——を
// そのまま流用して「門の前に立つ」ところから始める。ロゴとキャッチコピーはホームから**移設**した
// もので、両方に出すと同じ銘板が2画面続けて出ることになる（同指示「ホーム画面にタイトルいらない」）。
//
// タップで入る形にしているのは演出のためだけではない: ブラウザの自動再生ポリシー上、
// AudioContextの解放にはどのみち最初のユーザー操作が要る（audio/engine.jsの
// initAudioUnlockOnFirstGesture）。この1タップがそれを兼ねるので、ホームに着いた時点で
// 既にBGMが鳴っている状態になる。
export function TitleScreen({ onEnter }) {
  const [leaving, setLeaving] = useState(false);
  const enter = () => {
    if (leaving) return;
    // **全画面に入れるのはここだけ。** requestFullscreen はユーザーの操作から直接呼ばれた
    // ときしか通らないので、下の setTimeout の中や onEnter 側へ移すと無言で失敗する
    // （fullscreen.js の注記参照）。押した瞬間に、同期で呼ぶこと。
    if (getSettings().fullscreen) enterFullscreen();
    setLeaving(true);
    // 退出アニメ(kj-title--leaving)と尺を合わせる。先にホームを描き始めてクロスフェードさせる。
    setTimeout(onEnter, 460);
  };
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Enter" || e.key === " ") enter(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // ロビーの3Dの主卓（three.js 約260KB）をタイトル画面の間に読んでおく。ロビーに入った時点で
  // 読み終わっていれば、卓が2Dから3Dへ差し替わる瞬間が見えない（待ち時間をタイトルに隠す）。
  useEffect(() => { prefetchLobby3D(); }, []);
  return (
    <div
      className={`kj-title kj-pressable${leaving ? " kj-title--leaving" : ""}`}
      onClick={enter} role="button" tabIndex={0}
    >
      <div className="kj-facade-sky" />
      <div className="kj-facade-uplight" />
      {/* 紋章とキャッチコピーは撤去した。銘板1枚と「TAP TO START」だけ。 */}
      <div className="kj-title-lockup">
        <FacadeWordmark large />
      </div>
      <div className="kj-title-start" style={{
        fontFamily: FONT.display, fontWeight: 700, fontSize: 11,
        letterSpacing: "0.42em", marginRight: "-0.42em", color: GILT.base, marginTop: 12,
      }}>TAP TO START</div>
    </div>
  );
}
