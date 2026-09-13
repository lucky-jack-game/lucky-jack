// ホーム画面＝グランドホールのロビー。キャリアは別画面（screens/CareerScreen.jsx の RankingScreen）。
//
// 【ファサードからグランドホールのロビーへ】
// 前身はリゾートホテルの外観を建築の言語に翻訳した
// ファサード＝建物の正面玄関だった。扉の先の空間が無かったので、高級カジノホテルの大ホールに作り替えた。
// 参考にしたのは「ゲームセンターという世界の中にゲームがある」構成のポートフォリオサイトで、
// **借りたのは構成と入場の演出だけ**。ネオンの配色は借りていない（ラスベガスの語彙はファサード化の時点で外した）。
//   ヘッダー … 名札は右上へ（screens/HeaderStatus.jsx の PlayerPlate）
//   中央     … 展示の壁龕に据えた主卓（LobbyArt.jsx）と、PLAY 1枚
//   左右     … TODAY / RECORD のパネル。**載せるのは実在する値だけ**
//   基壇     … 遊び方
//
// **入口は PLAY 1枚だけ**（メニューの情報量と審査を優先）。オンライン対戦と
// ルームは今回の提出に入れない（features.js）。以前は「対戦／練習」の2枚の扉を同じ形で並べていたが、
// 審査員が触るのは CPU 練習だけなので、選ばせる物そのものが無い。PLAY を押すと主卓へ潜り（LOBBY_DIVE_MS）、
// ロード画面（GameLaunchScreen）を経て、開始前の画面を挟まずに対戦が始まる。
//
// **主卓は対戦で使う卓そのもの**（装備中の卓スキン・カードスキンで立つ）。スキンを替えるとロビーの卓が
// 替わるので、「稼ぐ→買う→装備する」の輪がホームで目に見えて一周する。PLAY で潜る先もこの卓。
//
// **「賑わい」を偽のデータで作らないこと。** 参考の構成には NEWS / RECOMMEND / 接続人数の類があるが、
// サーバーに記録が無い以上すべて作り話になる。パネルの中身はどれも時計か localStorage から読める実在の
// 値で、押せば本来の置き場所（ショップ・キャリア）へ行く——ホームは入口であって、置き場所の二重化ではない。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getEquippedSkin, getEquippedTable, getSettings, getLoginDays, getShopNextRotationTs,
  getBoxes, getMatchHistory, getUnlockedAchievements, visibleAchievements,
} from "./storage.js";
import { GoldFoilText } from "./shared.jsx";
import { PlayingCard } from "./CardArt.jsx";
import { TABLE_THEMES } from "./TableArt.jsx";
import { LobbyHall, LobbyStage } from "./LobbyArt.jsx";
import { playLobbyLights, playCardFlip, playLobbyDive, playShuffle } from "./audio/sfx.js";
import BulbIcon from "./icons/BulbIcon.jsx";
import "./lobby.css";

// ─── 入場の演出 ───
// 参考の構成は約15秒の起動演出（背景→線が枠を描く→電源→起動画面→UI）だったが、審査員は1〜2試合しか
// 触らないので、骨格だけ借りて2.5秒以内に畳んだ。**「部屋に灯りが入っていく順番」**で見せる:
// ホール → 壁龕 → シャンデリア → 回廊の燭台（奥から手前へ）→ 壁龕の金の縁に光が走る → ペンダント灯 →
// スポット → 主卓 → PLAY → Queenがめくれる・パネル → 基壇。
// **時刻はここにしか書かない。** CSS（lobby.css）は root の style に書いた --t-* から遅延を取り、
// 音と3Dの札のめくりもこの値を読む——数字を2箇所に置くと、音と光がずれる。
export const LOBBY_INTRO = {
  hall: 0, alcove: 300, chandelier: 350, arches: 450, trace: 700,
  lamp: 1250, spot: 1370, table: 1450, play: 1800, reveal: 1950, panels: 1950, base: 2150,
  total: 2450,
};
const INTRO_VARS = Object.fromEntries(
  Object.entries(LOBBY_INTRO).map(([k, v]) => [`--t-${k}`, `${v}ms`]),
);

// PLAY を押してから主卓へ潜りきるまで（lobby.css の lobbyDive。値は --dive-ms で渡す）。
export const LOBBY_DIVE_MS = 640;

// 1ページの読み込みにつき1回だけ。対戦から戻るたびに暗転からやり直すと、ただの待ち時間になる。
let introStartedAt = 0;
const introPending = () => introStartedAt === 0 && !getSettings().reduceMotion;

// 演出が残り何ms続くか。デイリーログインボーナスのトーストを演出の後ろへ回すために App が読む
// （暗転中に出すと、ホールより先に「+20 CHIP」だけが浮かぶ）。
export function lobbyIntroRemainingMs() {
  if (!introStartedAt) return 0;
  return Math.max(0, introStartedAt + LOBBY_INTRO.total - Date.now());
}

// "wait"（タイトル画面の裏。最初のコマで止めておく）→ "play" → "done"。
// ready = タイトル画面を抜け、全面のチュートリアルも出ていない（裏で演出を消化させない——
// ログインボーナスのトーストで2度踏んだのと同じ種類の事故）。
function useLobbyIntro(ready) {
  const [phase, setPhase] = useState(() => (introPending() ? "wait" : "done"));
  useEffect(() => {
    if (phase !== "wait" || !ready) return;
    introStartedAt = Date.now();
    setPhase("play");
  }, [phase, ready]);
  useEffect(() => {
    if (phase !== "play") return undefined;
    // 重ねる音は必ずずらす（同時に鳴らすと1つの雑音に潰れる）。灯りと札のめくりは700msずれている。
    const timers = [
      setTimeout(playLobbyLights, LOBBY_INTRO.lamp),
      setTimeout(playCardFlip, LOBBY_INTRO.reveal),
      setTimeout(() => setPhase("done"), LOBBY_INTRO.total + 150),
    ];
    return () => timers.forEach(clearTimeout);
  }, [phase]);
  // 演出中にどこかを押したら即座に最後のコマへ飛ばす（押した物への操作はそのまま通す）。
  return [phase, () => setPhase("done")];
}

function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const pad2 = (n) => String(n).padStart(2, "0");
function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
}

function PanelHead({ children }) {
  return (
    <span className="kj-lobby-panel-head">
      <span className="kj-lobby-panel-title">{children}</span>
    </span>
  );
}

// 左＝TODAY。今日この場所で起きていること。
function TodayPanel({ onOpenShop }) {
  const now = useNow(1000);
  const boxes = Object.values(getBoxes()).reduce((a, b) => a + b, 0);
  return (
    <section className="kj-lobby-panel left" aria-label="TODAY">
      <PanelHead>TODAY</PanelHead>
      <span className="kj-lobby-row">
        <span>ログインボーナス</span>
        <b>{getLoginDays()}<small>日目</small></b>
      </span>
      {/* 品揃えは1時間ごとに決定論的に入れ替わる（storage.js の getShopNextRotationTs）ので、
          残り時間は作り話ではなく本当に次の棚が来るまでの時間。 */}
      <button type="button" className="kj-pressable kj-lobby-row link" onClick={() => onOpenShop("shop")}>
        <span>ショップ入れ替え</span>
        <b>{formatCountdown(getShopNextRotationTs() - now)}</b>
      </button>
      <button type="button" className="kj-pressable kj-lobby-row link" onClick={() => onOpenShop("box")}>
        <span>報酬ボックス</span>
        <b>{boxes}<small>個</small></b>
      </button>
    </section>
  );
}

// 右＝RECORD。この端末に残った自分の記録（数え方はキャリア画面と同じ）。
// **行ごとに行き先が違うので、パネル全体を1つのボタンにしない**。
// 戦績と直近は
// キャリアへ、実績は実績一覧へ。TODAY 側と同じく `button.kj-lobby-row`（行の右端に「›」が出る）で
// 押せる行だけを押せるように見せる——パネルごと押せる形のままでは、行を分けても行き先を言えない。
const RECENT = 5;
function RecordPanel({ onOpenCareer, onOpenAchievements }) {
  const all = getMatchHistory();
  const wins = all.filter((h) => h.won).length;
  // 直近は古い順に左から並べ、いちばん右が最新。**まだ打っていない枠も出す**——枠が無いと、
  // 数が足りないのか負けが込んでいるのか区別が付かない（進捗表の未消化ラウンドと同じ規則）。
  const recent = all.slice(0, RECENT).reverse();
  const slots = [...Array(RECENT - recent.length).fill(null), ...recent];
  // 実績は画面に出している物だけで数える（取る手段の無い段位の実績を母数に入れない。storage.js）。
  const shown = visibleAchievements();
  const unlocked = new Set(getUnlockedAchievements());
  const got = shown.filter((a) => unlocked.has(a.id)).length;
  return (
    <section className="kj-lobby-panel right" aria-label="RECORD">
      <PanelHead>RECORD</PanelHead>
      <button type="button" className="kj-pressable kj-lobby-row link" onClick={onOpenCareer}>
        <span>戦績</span>
        <b>{wins}<small>勝</small> {all.length - wins}<small>敗</small></b>
      </button>
      {/* 直近は数字ではなく菱形なので「›」の付く行にしない（押せる行の合図は b の中に出る）。 */}
      <span className="kj-lobby-row">
        <span>直近</span>
        <span className="kj-lobby-pips">
          {slots.map((h, i) => (
            <i key={i} className={`kj-lobby-pip${!h ? "" : h.won ? " win" : h.draw ? " draw" : " lose"}`} />
          ))}
        </span>
      </span>
      <button type="button" className="kj-pressable kj-lobby-row link" onClick={onOpenAchievements}>
        <span>実績</span>
        <b>{got}<small> / {shown.length}</small></b>
      </button>
    </section>
  );
}

// introReady: タイトル画面を抜け、全面のチュートリアルも出ていないか（App が渡す）。
// onPlay: 主卓へ潜りきった後に呼ばれる。App はここでロード画面（GameLaunchScreen）を出す。
// 最後に実測した壁龕の矩形（ホールに対する%）。**ホーム以外のタブでも同じ部屋を敷くため**に
// ここへ残す。
// 壁龕はロビーの中身の中にしか無いので、ホームを離れると測る対象そのものが消える——比で持って
// あるぶん画面の大きさが変わっても崩れないので、最後の値をそのまま使い回せる。
// **null のままでも描けること**（LobbyArt の LobbyHall は room が無ければ地の照明だけを描く）。
let lastRoom = null;

// ホーム以外のタブに敷く部屋の絵。演出のクラスは掛けない——入場の演出はホームのものなので、
// ショップや設定を開くたびに部屋が組み上がり直すと、そちらが主役のように見える。
export function LobbyBackdrop() {
  return (
    <div className="kj-lobby-bg" aria-hidden="true">
      <LobbyHall room={lastRoom} />
    </div>
  );
}

export function HomeLobbyScreen({ introReady, onPlay, onOpenHowTo, onOpenCareer, onOpenAchievements, onOpenShop }) {
  const [phase, skipIntro] = useLobbyIntro(introReady);
  const rootRef = useRef(null);
  const diveTimer = useRef(null);
  const [diveOrigin, setDiveOrigin] = useState(null);
  useEffect(() => () => clearTimeout(diveTimer.current), []);

  // 部屋の奥の面＝壁龕の矩形を実測して LobbyHall へ渡す（床・天井・壁・柱は全部ここから引く）。
  // **CSSの固定値で置かないこと**——壁龕は中央棟のフローの中にあり、画面の高さ・幅・CSS zoom で
  // 位置が動く。ずれた瞬間に床と卓が接がなくなり、部屋が「並べた帯」に戻る。
  //
  // **基準はアプリの外枠（.kj-app-shell）。** 部屋の絵はヘッダー（ナビ）の裏まで敷くので
  // （下の createPortal）、コンテンツ領域ではなく外枠に対する比で持たないと、部屋だけが
  // ヘッダーの高さぶんずれる。
  const [room, setRoom] = useState(null);
  const [shellEl, setShellEl] = useState(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const shell = root.closest(".kj-app-shell");
    if (!shell) return undefined;
    setShellEl(shell);
    const measure = () => {
      const alcove = root.querySelector(".kj-lobby-alcove");
      const r = shell.getBoundingClientRect();
      if (!alcove || !r.width || !r.height) return;
      const a = alcove.getBoundingClientRect();
      // 比で持つ（同じ要素どうしの比は CSS zoom が掛かっていても変わらない。dive と同じ理由）。
      const next = {
        x0: ((a.left - r.left) / r.width) * 100,
        x1: ((a.right - r.left) / r.width) * 100,
        y0: ((a.top - r.top) / r.height) * 100,
        y1: ((a.bottom - r.top) / r.height) * 100,
      };
      // 動いていないなら state を触らない（ResizeObserver → setState → 再描画の往復を切る）。
      setRoom((prev) => {
        if (prev && Object.keys(next).every((k) => Math.abs(prev[k] - next[k]) < 0.15)) return prev;
        lastRoom = next; // ホーム以外のタブの背景（LobbyBackdrop）が使い回す
        return next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(shell);
    return () => ro.disconnect();
  }, []);

  // PLAY：見ていた主卓へそのまま潜ってから、ロード画面へ渡す。拡大の起点は主卓の中心。
  // モーション低減なら潜らずに即座に渡す。
  const play = () => {
    if (diveOrigin) return;
    if (getSettings().reduceMotion) { onPlay(); return; }
    const root = rootRef.current;
    const alcove = root?.querySelector(".kj-lobby-alcove");
    let origin = "50% 40%";
    if (root && alcove) {
      const r = root.getBoundingClientRect();
      const a = alcove.getBoundingClientRect();
      // **比率で渡す。** PC横長は .kj-app-shell に CSS zoom が掛かっており、px は座標系が食い違うが、
      // 同じ要素どうしの比は zoom が掛かっていても変わらない。
      const x = ((a.left + a.width / 2 - r.left) / r.width) * 100;
      const y = ((a.top + a.height * 0.66 - r.top) / r.height) * 100;
      origin = `${x}% ${y}%`;
    }
    setDiveOrigin(origin);
    playLobbyDive();
    diveTimer.current = setTimeout(onPlay, LOBBY_DIVE_MS);
  };

  const intro = phase !== "done";
  const cls = [
    "kj-lobby",
    intro && "kj-lobby--intro",
    phase === "wait" && "kj-lobby--wait",
    diveOrigin && "kj-lobby--leaving",
  ].filter(Boolean).join(" ");
  const style = {
    ...(intro ? INTRO_VARS : null),
    ...(diveOrigin ? { "--dive-origin": diveOrigin, "--dive-ms": `${LOBBY_DIVE_MS}ms` } : null),
  };
  // 背景の層。コンテンツと同じ演出のクラスを掛ける（cls から中身の並び用のクラスだけ外した物）。
  const bgCls = [
    "kj-lobby-bg",
    intro && "kj-lobby--intro",
    phase === "wait" && "kj-lobby--wait",
    diveOrigin && "kj-lobby--leaving",
  ].filter(Boolean).join(" ");
  return (
    // **ホームは送れない画面にする。** 以前は overflowY:auto で、中身が画面より少しでも長い端末では
    // 中身だけが送れ、外枠の直下に portal した部屋（背景）は止まったまま——背景以外がスクロールで少し
    // 動く状態になっていた（スマホのChrome。実測で 360×640 のとき 23px）。
    // 部品は1画面に収まる大きさで組み、背の低い画面では lobby.css の末尾で詰める。
    // 潜る演出で拡大した分がはみ出しても、同じくここで外へ漏らさない。
    <div style={{ height: "100%", overflow: "hidden" }}>
      <div ref={rootRef} className={cls} style={style}
        onPointerDown={phase === "play" ? skipIntro : undefined}>
        {/* **部屋の絵はアプリの外枠の直下へ出す**（ヘッダーの裏まで敷くため）。ナビを浮かせたり他の画面の
            余白を足したりすると、対戦画面やショップまで巻き込んで壊れる——背景だけを外へ出せば
            レイアウトには一切触らない。入場の演出と潜る演出のクラスは同じ物をこの層にも掛ける
            （掛けないと、部屋だけ演出から取り残される）。 */}
        {shellEl && createPortal(
          <div className={bgCls} style={style} aria-hidden="true">
            <LobbyHall room={room} />
          </div>,
          shellEl,
        )}

        <div className="kj-lobby-massing">
          {/* 中央棟。DOM上は先頭に置き、PCでのみ明示配置で2列目に移す（lobby.css参照） */}
          <div className="kj-lobby-center">
            <LobbyStage
              tableTheme={getEquippedTable()} cardTheme={getEquippedSkin()}
              introPhase={phase} revealMs={LOBBY_INTRO.reveal}
            />
            {/* 卓へ上がる段と絨毯。**絵だけで、押せる物ではない**（aria-hidden）。
                PLAY を「ボタン」ではなく「卓へ向かう場所」に見せるための導線で、台座から
                手前へ広がる台形が視線をそのまま PLAY へ落とす。押す物は今まで通り銘板1枚
                ——導線を敷いても、押せることは曖昧にしないこと（審査員は最初の一手で迷う）。 */}
            <div className="kj-lobby-approach" aria-hidden="true"><i /></div>
            {/* 入口はこの1枚だけ。扉の建材（アーチ・金の二重トリム・石の壁面・頂の灯り）はそのまま使い、
                大きさと箔押しの文字で「ここを押す」ことだけを言う。**2枚目・3枚目を足さないこと。**
                卓を押して対戦に入れる形も、入口が2つあるのと同じになる。 */}
            <button type="button" onClick={play}
              className="kj-pressable kj-door kj-arch kj-gilt kj-plate kj-lobby-play">
              <GoldFoilText size={26} spacing="0.36em" sheen={false}>PLAY</GoldFoilText>
            </button>
          </div>

          <TodayPanel onOpenShop={onOpenShop} />
          <RecordPanel onOpenCareer={onOpenCareer} onOpenAchievements={onOpenAchievements} />

          <div className="kj-lobby-base">
            <button type="button" className="kj-pressable kj-lobby-howto" onClick={onOpenHowTo}>
              <BulbIcon size={12} />遊び方
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PLAY を押した後のロード画面 ───
// **本当に読み込んでいる間を覆う物にする。** 対戦画面（battle/PracticeMatch.jsx）と3Dの盤面
// （three/BattleScene3D.jsx）はどちらも遅延読み込みなので、初回はここで実際に待つ（loaders）。
// ただし一瞬で読み終わると点滅にしか見えないので、最低 LAUNCH_MIN_MS は見せる。
// 読み込みの失敗はここでは握りつぶして先へ進む——ロード画面が永久に閉じないのが最悪で、
// 失敗は対戦画面の側（Suspense とその中の3D）で扱われる。
// 見せる物はディーラーが札を切る所だけ。敷いている色は装備中の卓スキンのフェルト。
// PLAY から対戦画面が見えるまでは、潜る(640) + ここ + 満ちる(220) + 消える(460) ≒ 2.4秒。
// 1.4秒にしていた版は計3秒近くかかり、「少しだけ」ではなくなっていた。
export const LAUNCH_MIN_MS = 1100;
const LAUNCH_REVEAL_MS = 460; // lobby.css の launchOut と揃える（--launch-reveal で渡す）

// revealing: 対戦画面を裏でマウントし終え、ロード画面が消えていく段階（App が切り替える）。
// onReady: 読み込みと最低時間の両方が済んだ。App はここで対戦画面をマウントし revealing にする。
// onDone: 消えきった。App はロード画面を外す。
export function GameLaunchScreen({ loaders, revealing, tableTheme, cardTheme, onReady, onDone }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const minTime = new Promise((resolve) => setTimeout(resolve, LAUNCH_MIN_MS));
    Promise.all([minTime, ...loaders.map((load) => load().catch(() => null))])
      .then(() => { if (alive) setLoaded(true); });
    // 音はタイマーで鳴らす（StrictMode の二重実行で2回鳴らさないため。1回目の後始末で消える）。
    const shuffle = setTimeout(playShuffle, 180);
    return () => { alive = false; clearTimeout(shuffle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!loaded) return undefined;
    const t = setTimeout(onReady, 220); // 進捗の線が満ちきるのを見せてから
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  useEffect(() => {
    if (!revealing) return undefined;
    const t = setTimeout(onDone, LAUNCH_REVEAL_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealing]);

  const felt = (TABLE_THEMES[tableTheme] || TABLE_THEMES.classic).inner;
  return (
    <div
      className={`kj-launch${revealing ? " kj-launch--leaving" : ""}`}
      role="status" aria-label="読み込み中"
      style={{ "--launch-felt": felt, "--launch-ms": `${LAUNCH_MIN_MS}ms`, "--launch-reveal": `${LAUNCH_REVEAL_MS}ms` }}
    >
      {/* 裏面は金に光らせる（報酬ボックスの開封と同じ rarityGlow）。素の裏面は青黒く、
          暗いロード画面の上では札があることすら見えなかった。 */}
      <div className="kj-launch-deck">
        {[0, 1, 2].map((i) => (
          <div key={i} className="kj-launch-card" style={{ "--i": i }}>
            <PlayingCard faceDown width={72} theme={cardTheme} rarityGlow="#caa452" />
          </div>
        ))}
      </div>
      <div className="kj-launch-caption">SHUFFLING</div>
      <div className={`kj-launch-bar${loaded ? " done" : ""}`}><i /></div>
    </div>
  );
}
