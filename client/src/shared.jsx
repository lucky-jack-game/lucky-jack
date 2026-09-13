// 1対1の対戦の共通UIパーツ。対戦画面そのものは client/src/battle/ にある。
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { PlayingCard, ChipToken, NUMBER_ROMAN, QUEEN_COLOR, RAISE_PURPLE } from "./CardArt.jsx";
import { getEquippedSkin, getEquippedTable, getSettings } from "./storage.js";
import { resolveRank, RP_PER_TIER } from "./rank.js";
import RankBadge from "./icons/RankBadge.jsx";
import { PAIR_KEYS, BET_ACTION_ORDER, useSlotKeys, usePointerFine, normalizeBetKeys, normalizeFoldGuard, keyLabel } from "./keybinds.js";
import { RAISE_FRACTIONS, raiseCost } from "../../shared/engine.js";
import { playTick, playKjChoice, playRaise, playCall, playFold } from "./audio/sfx.js";
// three.js/@react-three/fiber一式を静的importすると、対戦しないユーザー（ホーム画面や設定画面だけ
// 開いた人）も含め全員のメインバンドルにgzip 380KB超が乗る（実際に計測して判明した不具合）。
// **3D関連は必ず動的importで分離すること。**
const BattleScene3D = lazy(() => import("./three/BattleScene3D.jsx").then((m) => ({ default: m.BattleScene3D })));

// 数字カードの表示定数はCardArt.jsxに集約し、ここでは再エクスポートする。
// 特殊札はQueen（無条件勝利、内部識別子は "king" のまま）のみ。KING/JOKERは払い出しの向き
// （勝者総取り／敗者総取り）を選ぶ1枚のカードで、Queenとは別物。
export { NUMBER_ROMAN, QUEEN_COLOR, RAISE_PURPLE, ChipToken };


// 「色=意味」のギャンブル配色トークン
export const CHIP_GOLD = "#F2C230";
export const FLAME_ORANGE = "#FF8C32";
export const PENALTY_RED = "#FF4D4D";

// 角丸3段階 + ダーク背景の明度階層トークン
// 境界線で全部を囲うのではなく、この明度差(SURFACE)で「浮き上がり」を表現する。
export const RADIUS = { sm: 6, md: 14, lg: 24 };
export const SURFACE = {
  panel: "#0f0f18",       // 土台(#08080d相当)より一段明るいパネル面
  panelSelf: "#101a2c",   // 自分側パネル。panelと同じ明度階層で色相だけ変える
  card: "#171721",        // パネルよりさらに一段明るいカード/ボタン休止面
  hairline: "rgba(255,255,255,0.08)",
  hairlineStrong: "rgba(255,255,255,0.16)",
  // 二次テキスト用の暖色グレー。旧来の#8a8a99/#888/#aaa(寒色寄り)はカード/テーブルの
  // 金・アンティークゴールド調パレットと馴染まなかったため、褐色を混ぜた暖色グレーに統一する
  // （ボタン・文字色をカード/テーブルの世界観に揃える一環）。
  textMuted: "#a49a89",
  hairlineWarm: "rgba(216,196,150,0.18)",
};

// ─── 書体トークン ───────────────────────────────────────────────
// **実体は index.css の :root（--font-display / --font-body）。ここは参照するだけ。**
// 書体そのものを差し替えるときも触るのはあちらの2行で、このファイルは変わらない
// ——以前は同じ指定文字列が .jsx と .css の28箇所へベタ書きされており、1箇所でも漏らすと
// その要素だけ別の書体で出た。
// インラインstyleに渡す値なので var() のままでよい（CSSの変数はstyle属性でも解決される）。
//
// **見出し用の書体は日本語グリフを持たない**（Inter・かつてのOrbitron、いずれも）。だから
// --font-display のフォールバック先は必ず本文書体でなければならない。怠るとその要素の日本語
// だけが総称`sans-serif`（＝OS標準。Windowsなら游ゴシック/メイリオ）へ無言で落ち、画面上の
// 日本語が「display指定を受けた要素かどうか」で2種類に割れる（かつて73箇所でそうなっていた）。
export const FONT = {
  display: "var(--font-display)",
  body: "var(--font-body)",
};

// 数値表示。桁が変わっても幅が動かないようtabular-numsを効かせる
// （ポットやポイントは1桁ずつカウントアップする箇所があり、等幅でないと数字が踊る）。
export function numeralStyle(size, color, weight = 700) {
  return { fontFamily: FONT.display, fontWeight: weight, fontSize: size, color, fontVariantNumeric: "tabular-nums" };
}

// ─── 金の階調 ───────────────────────────────────────────────
// index.cssの`--gilt`系・3Dカード/卓のアンティークゴールドと同じ値。JS側には長らく
// 旧ネオン金`#e8c874`とTailwind風の借り物色(`#60a5fa`/`#f87171`/`#333`/`#666`)が
// 混在しており、同じ画面に3系統の配色が同居していた。新規のUIは必ずここを使う。
export const GILT = {
  bright: "#e8c874",  // 強調・アクティブな縁
  base: "#caa452",    // 基準の金（カードの枠と同色）
  deep: "#8d6c25",    // 沈んだ金（境界線・非アクティブ）
  dim: "#4a3c22",     // 消灯状態（旧#333/#555の置き換え先）
  ivory: "#f4e7bf",   // 文字の主色（カードの数字グリフと同色）
};

// PC横長では`.kj-page-scroll`が中央640pxにコンテンツを制限するため、それ以外の領域が
// 装飾のない単なる黒背景になり「余白が多いだけ」に見えてしまう画面（キャリア等）向けの
// 控えめなアンビエント演出。HomeLobbyScreenのスポットライト演出と同じ手法を再利用する
// （実際の余白を埋めるのではなく、背景に奥行きを持たせることで「意図的な余白」に転化する）。
export function ScreenAmbientGlow() {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
      background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(232,200,116,0.08), transparent 60%)",
    }} />
  );
}

// PC横長(768px以上)かどうかを判定するフック
// レイアウトの大枠転換はCSSメディアクエリ(index.css)側で行うが、
// JSX側の分岐（補助パネルの中身の出し分け等）が必要な箇所のために用意する。
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : false
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}


// ─── リング型カウントダウンタイマー ───
// サーバー権威の判定タイミングと厳密同期しない前提の「演出」。
// 閾値: 50%超=ゴールド、20〜50%=オレンジ、20%未満=赤+呼吸パルス。
export function CountdownRing({ seconds, total = 30, size = 48 }) {
  const clamped = Math.max(0, seconds);
  const ratio = total > 0 ? clamped / total : 0;
  const isLow = ratio <= 0.2;

  // 残り5秒以下でtick音を鳴らす（同じ秒数で重複発火しないようrefで直前値を記憶）
  const prevSecRef = useRef(clamped);
  useEffect(() => {
    if (clamped <= 5 && clamped > 0 && clamped !== prevSecRef.current) playTick();
    prevSecRef.current = clamped;
  }, [clamped]);
  const isMid = !isLow && ratio <= 0.5;
  const color = isLow ? "#FF3B3B" : isMid ? "#FF8C32" : "#F2C230";
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * Math.max(0, Math.min(1, ratio));

  return (
    <div style={{
      position: "relative", width: size, height: size, flexShrink: 0,
      animation: isLow && clamped > 0 ? "timerBreathe 0.5s ease-in-out infinite" : "none",
    }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#171009" strokeWidth={4} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={4} strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: "stroke-dasharray 0.9s linear, stroke 0.3s ease" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-display)", fontWeight: 900, fontVariantNumeric: "tabular-nums",
        fontSize: size * 0.38, color, letterSpacing: -0.5,
      }}>{clamped}</div>
    </div>
  );
}


// ─── KING/JOKER選択ボタン：payout方向(勝者総取り/敗者総取り)を実カードのビジュアルで選ばせる ───
// kind: "king"（カードの勝者が総取り）| "joker"（カードの敗者が総取り）
// selected: 「選んでから確定する」用途でのみ渡す。**既定はnull＝中立**で、
// ベットループのKING/JOKER選択（押した瞬間に確定するので選択状態が存在しない）は今までどおり
// 両方とも等しく明るいまま表示される——ここをfalse既定にすると、そちらの2枚が常に暗く沈む。
export function DeclarationButton({ kind, onClick, rewardLabel, width = 56, selected = null }) {
  const color = kind === "king" ? "#4ade80" : "#FF4D4D";
  const lit = selected === true;
  const dim = selected === false;
  return (
    <button onClick={onClick} className="kj-pressable kj-card-hoverable" style={{
      background: "transparent", border: "none", cursor: "pointer", padding: 0,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      opacity: dim ? 0.62 : 1,
      filter: lit ? `drop-shadow(0 0 14px ${color}aa)` : "none",
      transform: lit ? "translateY(-4px)" : "none",
      transition: "opacity 0.2s ease, filter 0.2s ease, transform 0.2s ease",
    }}>
      <PlayingCard variant="declaration" declaration={kind} width={width} theme={getEquippedSkin()} />
      {rewardLabel && <div style={{ fontSize: 12, color, fontWeight: 700 }}>{rewardLabel}</div>}
    </button>
  );
}





// ─── KING/JOKER選択パネル：自分の番なら選ばせ、相手の番なら待機表示 ───
// highlight: "king" | "joker" — 実践チュートリアルが「今どれを押すか」を指し示すために使う。
// **本物のボタンを光らせる**のが要点で、説明用の偽ボタンを別に描かない（操作が本番に転移しない）。
export function KJChoicePanel({ isChooser, onChoose, waitingLabel, highlight }) {
  const pointerFine = usePointerFine();
  // 2択も同じ規則で「画面の左から順に A / S」。並び順は画面に出ている物の順序そのものなので
  // ここは設定対象にしない（設定できるのはベット行の並びとフォールドキーだけ）。
  const pick = (kind) => { playKjChoice(); onChoose(kind); };
  useSlotKeys(
    [{ id: "king", key: PAIR_KEYS[0], onTrigger: () => pick("king") },
     { id: "joker", key: PAIR_KEYS[1], onTrigger: () => pick("joker") }],
    { enabled: !!isChooser },
  );
  if (!isChooser) {
    return <div style={{ textAlign: "center", fontSize: 13, color: SURFACE.textMuted, padding: "10px 0" }}>{waitingLabel}</div>;
  }
  // 高さは操作ドック(.kj-action-dock)の固定高さに収める必要がある: ドックが content の高さで
  // 伸びると、その上に敷いてある3Dの卓へ食い込んでしまうため(実際に踏んだ不具合)。
  // 説明文は1行に畳み、カードも一回り小さくしてある。
  // **説明文は置かない**。「あなたの番です — 払い出し方向を選択」も
  // 「勝者総取り/敗者総取り」も、押せる物が2つ出ていること自体が同じことを言っている。
  // 押せば結果が出て、次からは覚えている——規則はチュートリアルと遊び方の画面が持つ。
  return (
    <div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
        {["king", "joker"].map((kind, i) => (
          <div key={kind} className={highlight === kind ? "kj-spotlight" : undefined} style={{ position: "relative", borderRadius: 8 }}>
            <DeclarationButton kind={kind} onClick={() => pick(kind)} width={44} />
            {pointerFine && <span className="kj-keyhint kj-keyhint--float">{keyLabel(PAIR_KEYS[i])}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ポットの表示 ───
// **チップの絵は置かない。** 賭けの単位はライフ（灯り）で、その実物は卓の上に3Dで積まれている
// （three/Lights3D.jsx）。ここにチップの山を描くと、同じポットが2つの素材で二重に表される。
// ドックが担うのは「いくつか」を数字で確定させることだけ——ただし卓の灯りと同じ形の点を
// 添えて、卓の上のあれと同じものを数えているのだと分かるようにしておく。
function PotStack({ pot, unit = "ライフ" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, marginBottom: 4 }}>
      <div style={{ display: "flex", gap: 4, justifyContent: "center", minHeight: 9 }}>
        {Array.from({ length: Math.min(pot, 12) }, (_, i) => (
          <span key={i} style={{
            width: 8, height: 8, borderRadius: "50%",
            background: `radial-gradient(circle at 35% 30%, #fff8e0, ${CHIP_GOLD} 60%, rgba(0,0,0,0.4))`,
            boxShadow: `0 0 6px ${CHIP_GOLD}`,
          }} />
        ))}
      </div>
      <div style={{ ...numeralStyle(20, CHIP_GOLD, 900), letterSpacing: "0.04em" }}>{pot} {unit}</div>
    </div>
  );
}

// ─── ベット操作パネル：check/call/raise/foldをポットの状況に応じて出し分ける ───
// highlight: BET_ACTION_ORDERのid（"fold"|"callCheck"|"raiseHalf"|"raisePot"）。KJChoicePanelと同じく
// 実践チュートリアル専用で、本番の呼び出し元は渡さない（渡さなければ従来と完全に同じ挙動）。
// costFn / unit: 賭けの単位を差し替える口。**旧トーナメントはポイント(10刻み)、現行ルールは
// ライフ(整数1)**で、レイズ幅の計算式そのものが別のエンジンに載っている。既定は旧エンジンなので、
// 渡さない呼び出し元は1行も変えなくてよい。
// 実際に踏んだ不具合: ここを固定にしたまま現行ルールに流用したところ、卓では1ライフしか
// 動いていないのにボタンには「ベット +20」、ポットには「2pt」と出た（旧エンジンのRAISE_STEP=20と
// pt表記がそのまま出ていた）。**表示に使う計算は、実際に引かれる計算と同じ関数でなければならない。**
export function BetActionPanel({ pot, canRaise = true, yourTurn, pendingRaise, pendingAmount, toCall = null, room = null, allIn = false, onAction, opponentName, highlight, costFn = raiseCost, unit = "ライフ", minCall = 1 }) {
  // キー割り当てとフォールドキーの扱いは設定から。マウント時に1度だけ読めば足りる
  // (設定を変えられるのは対戦画面の外なので、次にこのパネルが出る時には必ず反映される)。
  const [cfg] = useState(() => {
    const s = getSettings();
    return { keys: normalizeBetKeys(s.betKeys), foldGuard: normalizeFoldGuard(s.foldGuard) };
  });
  const pointerFine = usePointerFine();

  // 1つのスロットが状況で2つの意味を持つ（pendingRaiseの有無で コール⇄チェック / レイズ⇄ベット）。
  // 内部のアクション名は従来どおり "call"/"check"/"raise" のままで、サーバー側は一切変わらない。
  // ボタンには**分数ではなく実際に飛ぶ額**を出す（判断に使うのは「いくら出るか」であって比率ではない。
  // 切り下げで1/2ポットが正確に半分にならないことがあるが、実額表示ならそもそも食い違いが生まれない）。
  // **コール額は盤面の拠出の差(toCall)そのもの。相手が積もうとした額(pendingAmount)ではない。**
  // 1局の拠出には上限(shared/engine.jsのroundBetCap)があり、相手のレイズが上限で切られると
  // 「積もうとした額」と「実際に積まれた額」が食い違う——実測で**コールの14.2%**がこれに当たり、
  // 相手が1しか増やしていないのにボタンには「コール +2」と出ていた。
  // 切られた分まで自分が払うわけではないので、必ず盤面の差から取ること。
  const callAmt = toCall == null ? (pendingAmount || minCall) : toCall;
  // レイズは保留中の不足分を埋めてから上乗せするので、**実際に飛ぶのは owed + 上乗せ分**。
  // ここを上乗せ分だけの表示にすると、ボタンの数字と持ち点の減り方が食い違う。
  // **上限で切られる分もここで落とすこと**（コール額と同じ理由。engine.js の raiseCost は
  // 上限を知らないので、切るのは呼び出し側の仕事）。
  const raiseTotal = (fraction) => {
    const total = costFn(pot, pendingRaise ? callAmt : 0, fraction).total;
    return room == null ? total : Math.min(total, room);
  };
  const mkRaise = (id, fraction, tag) => ({
    id, bg: "#2a1a3a", accent: RAISE_PURPLE, key: cfg.keys[id],
    label: `${pendingRaise ? "レイズ" : "ベット"} +${raiseTotal(fraction)}`,
    // **押せない理由をボタン自身に書く。** 1局に賭けられるライフには上限があり
    // (shared/engine.js の roundBetCap)、達するとレイズだけが消える。灰色になった理由が
    // どこにも出ていないと、故障か「今は相手の番」かの区別がつかない。
    // 既にある sub の行に入れるので、ドックの固定高さには影響しない。
    sub: canRaise ? tag : "この局の上限",
    run: () => { playRaise(); onAction("raise", fraction); },
    // レイズ上限に達しても**ボタンを消さずに無効化して残す**。消して残りを詰めると
    // 同じキーが手の途中で別の意味に変わり、レイズのつもりでコールを出す事故になる。
    disabled: !canRaise,
  });
  const defs = {
    fold: {
      id: "fold", label: "フォールド", bg: "#3a1414", accent: "#FF4D4D", key: cfg.keys.fold,
      run: () => { playFold(); onAction("fold"); },
      hold: cfg.foldGuard === "hold", keyless: cfg.foldGuard === "off",
    },
    callCheck: {
      id: "callCheck", bg: "#1a2a1a", accent: "#4ade80", key: cfg.keys.callCheck,
      label: pendingRaise ? `コール +${callAmt}` : "チェック",
      run: () => { playCall(); onAction(pendingRaise ? "call" : "check"); },
    },
    raiseHalf: mkRaise("raiseHalf", RAISE_FRACTIONS.half, "1/2ポット"),
    raisePot: mkRaise("raisePot", RAISE_FRACTIONS.pot, "1ポット"),
  };
  const slots = BET_ACTION_ORDER.map((id) => defs[id]).filter(Boolean);

  const { holdSlotId, holdProgress } = useSlotKeys(
    slots.map((s) => (s.keyless || !s.key ? null : { id: s.id, key: s.key, onTrigger: s.run, disabled: s.disabled, hold: s.hold })),
    { enabled: yourTurn },
  );

  // **ベットが1手も成立しない局がある。** 拠出の上限は少ない方の残りライフなので、
  // どちらかが残り1ライフになるとアンティ(1)がそのまま上限になり、積む余地が消える
  // ——実測でカジュアルの局の11.9%、そして**試合の28.6%がこの局で終わる**。
  // ここを黙って素通りすると、カードを選んだ瞬間に試合が終わったようにしか見えない。
  // 押せるものが無い理由は盤面（残りライフ）に出ているので、名前を1つ与えるだけでよい。
  if (allIn) {
    return (
      <div style={{ textAlign: "center" }}>
        <PotStack pot={pot} unit={unit} />
        <div style={{ fontFamily: FONT.display, fontSize: 12, fontWeight: 800, letterSpacing: "0.18em", color: CHIP_GOLD }}>ALL IN</div>
      </div>
    );
  }
  if (!yourTurn) {
    return (
      <div style={{ textAlign: "center" }}>
        <PotStack pot={pot} unit={unit} />
        <div style={{ fontSize: 11, color: SURFACE.textMuted }}>{opponentName || "相手"}の番</div>
      </div>
    );
  }
  return (
    <div style={{ textAlign: "center" }}>
      <PotStack pot={pot} unit={unit} />
      {/* 横1列を保つこと。折り返すとドックの固定高さ(112/124px)を超えて3Dの卓へ食い込む。
          4枚に増えたぶんボタンは細くしてある（betBtnStyleのpaddingを上書き）。 */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
        {slots.map((s) => {
          const holding = holdSlotId === s.id;
          return (
            // キーヒントはボタンの**外側**のラッパーに置くこと。長押しの進捗を切り抜くために
            // ボタン側へ overflow:hidden を掛けており、内側に置くとヒントが刈り取られる（実際に踏んだ）。
            <div key={s.id} className={highlight === s.id ? "kj-spotlight" : undefined} style={{ position: "relative", display: "flex", borderRadius: 8 }}>
              <button
                onClick={s.disabled ? undefined : s.run}
                disabled={s.disabled}
                className="kj-pressable"
                style={{
                  ...betBtnStyle(s.bg, s.accent), padding: "7px 7px", fontSize: 11, letterSpacing: "0.02em",
                  position: "relative", overflow: "hidden",
                  opacity: s.disabled ? 0.32 : 1, cursor: s.disabled ? "default" : "pointer",
                }}
              >
                {/* 長押しの進捗。キーを離せば即座に消え、満ちた瞬間だけ発動する。
                    マウスのクリックは1発のままにしてある——狙って押しに行く動作自体が保険になるので、
                    そこに長押しを課すとテンポを削るだけになる。 */}
                {holding && (
                  <span style={{
                    position: "absolute", left: 0, top: 0, bottom: 0, width: `${holdProgress * 100}%`,
                    background: `${s.accent}55`, borderRight: `2px solid ${s.accent}`,
                    pointerEvents: "none", transition: "none",
                  }} />
                )}
                {/* 「フォールド」がモバイル390pxで"フォール/ド"に割れるため折り返さない。
                    4つが1段に収まる幅は実測で詰めてあるので、ここを緩めると必ずはみ出す。 */}
                <span style={{ position: "relative", display: "block", lineHeight: 1.15, whiteSpace: "nowrap" }}>
                  {s.label}
                  {s.sub && (
                    <span style={{ display: "block", fontSize: 8, letterSpacing: "0.04em", color: SURFACE.textMuted, marginTop: 1 }}>
                      {s.sub}
                    </span>
                  )}
                </span>
              </button>
              {pointerFine && !s.keyless && s.key && (
                <span className="kj-keyhint kj-keyhint--float" style={{ borderColor: `${s.accent}66` }}>
                  {keyLabel(s.key)}{s.hold ? " HOLD" : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ─── 箔押しの文字（index.cssの`.kj-foil`を扱う薄いラッパー） ───
// ホーム画面のファサードの銘板(.kj-facade-wordmark)で確立した「金箔の箔押し／彫り込み」を、
// 対戦画面でも同じ建材として使い回すためのもの（画面ごとに違う見出しの作り方を
// 増やさない、というファサード改修時の方針をそのまま適用する）。
// tone: "gold"(既定) | "ash"(喪失・鉛色) | "amethyst"(紫水晶)
export function GoldFoilText({ children, size = 28, tone = "gold", sheen = true, spacing = "0.16em", style }) {
  const toneClass = tone === "ash" ? " kj-foil--ash" : tone === "amethyst" ? " kj-foil--amethyst" : "";
  return (
    <span
      className={`kj-foil${toneClass}${sheen ? " kj-foil-sheen" : ""}`}
      // letter-spacingは最後の1文字の右側にも入るため、中央揃えだと見た目が左へずれる。
      // 同量の負のマージンで打ち消す（.kj-facade-wordmarkがtext-indentで行っているのと同じ補正）。
      style={{ fontSize: size, letterSpacing: spacing, marginRight: `-${spacing}`, whiteSpace: "nowrap", ...style }}
    >{children}</span>
  );
}


// ─── 段位（オンライン対戦のみ） ───
// キャリア画面(常設の現在地)とオンライン対戦の終了画面(その試合の収支)の両方が使う。
// **バッジ単体で段位名まで読ませようとしないこと**（rank.js記載の設計）——金属色と刻みの本数だけでは
// 隣接する段の判別が難しいので、必ずラベルを併記する。ここで1つに集約してあるのはそのためでもある。
//
// delta を渡すとRP収支と昇降格の告知を出す（終了画面用）。省略すれば現在地の表示だけになる。
export function RankProgressPanel({ totalRp, delta = null, promoted = false, demoted = false }) {
  const { tier, rpInTier, isMax } = resolveRank(totalRp);
  const ratio = isMax ? 1 : Math.max(0, Math.min(1, rpInTier / RP_PER_TIER));
  const gained = typeof delta === "number" && delta > 0;
  return (
    <div style={{
      background: SURFACE.card, borderRadius: RADIUS.md, padding: "14px 16px",
      border: `1px solid ${SURFACE.hairlineWarm}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <RankBadge tier={tier.id} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 15, color: tier.line, letterSpacing: "0.1em" }}>{tier.label}</span>
            <span style={{ fontSize: 11, color: SURFACE.textMuted }}>{tier.jp}</span>
          </div>
          <div style={{ ...numeralStyle(12, GILT.ivory), marginTop: 2 }}>
            {/* MONARCHはRPでは到達できない席数制のため、DIAMONDでは「/100」を出さない */}
            {rpInTier}{isMax ? " RP" : ` / ${RP_PER_TIER} RP`}
          </div>
        </div>
        {typeof delta === "number" && delta !== 0 && (
          <div style={{ ...numeralStyle(17, gained ? GILT.bright : SURFACE.textMuted), whiteSpace: "nowrap" }}>
            {gained ? "+" : ""}{delta}
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: GILT.dim, overflow: "hidden" }}>
        <div style={{
          width: `${ratio * 100}%`, height: "100%", borderRadius: 3,
          background: `linear-gradient(90deg, ${tier.to}, ${tier.from})`,
          transition: "width 0.6s cubic-bezier(.16,.84,.28,1)",
        }} />
      </div>

      {(promoted || demoted) && (
        <div style={{
          marginTop: 10, textAlign: "center",
          color: promoted ? GILT.bright : SURFACE.textMuted,
          fontSize: 12, letterSpacing: "0.08em",
        }}>{promoted ? `昇格 — ${tier.label} に到達` : `降格 — ${tier.label} へ`}</div>
      )}
    </div>
  );
}



export function btnStyle(bg) {
  return {
    padding: "8px 14px", borderRadius: RADIUS.sm, background: bg,
    border: `1px solid ${SURFACE.hairlineStrong}`, color: "#fff", cursor: "pointer", fontSize: 14,
  };
}

// ─── アウトライン用の控えめなボタン（「戻る」「編集」等の副次アクション向け）───
// 以前は各画面が`border:"1px solid #666"`のような無関係な灰色を個別にベタ書きしていたが
// (SettingsScreenの編集ボタン、対戦画面の戻るボタン等)、カード/テーブルの
// 金・暖色パレットと噛み合わない寒色グレーだったため、暖色ヘアライン+SURFACE.cardに統一する。
export function outlineBtnStyle() {
  return {
    padding: "8px 14px", borderRadius: RADIUS.sm, background: SURFACE.card,
    border: `1px solid ${SURFACE.hairlineWarm}`, color: SURFACE.textMuted, cursor: "pointer", fontSize: 14,
  };
}

// ─── 主要CTAボタン（「保存」「確定」等）。ホーム画面/ショップ画面の主要CTAと同じ金グラデーションに統一 ───
export function goldBtnStyle() {
  return {
    padding: "10px 18px", borderRadius: RADIUS.sm, border: "none",
    background: "linear-gradient(135deg, #e8c874, #FF8C00)",
    color: "#000", cursor: "pointer", fontSize: 14, fontWeight: 700,
  };
}

// ─── ベットループ用ボタン：色付きの縁取り+微発光でカードアートと同じ高級感を持たせる ───
// 素のフラットボタン(btnStyle)より一段リッチにする（fold=赤/call・check=緑/raise=紫、意味と色を対応させる）。
// フォールド/チェック/コール/レイズのボタン。
// 以前は fontFamily の指定が無く、周囲がすべてOrbitron/象牙で組まれている中で
// ここだけ本文書体・純白(#fff)・寒色の黒(#0b0806)という別系統の見た目になっていた
// 。
// 対戦の核になる操作なので、字間を開けた見出し書体・象牙の文字・暖色の黒に揃える。
// **fold=赤 / call=緑 のアクセントだけは変えないこと**——CardArt.jsxのKING宣言カード(緑)/
// JOKER宣言カード(赤)と意図的に一致させてある既存の配色で、色が意味を運んでいる。
function betBtnStyle(bg, accent) {
  return {
    padding: "9px 16px", borderRadius: RADIUS.sm,
    background: `linear-gradient(180deg, ${bg}, #0b0806)`,
    border: `1px solid ${accent}88`, boxShadow: `0 0 10px ${accent}33, inset 0 1px 0 rgba(255,255,255,0.08)`,
    color: GILT.ivory, cursor: "pointer",
    fontFamily: FONT.display, fontSize: 13, fontWeight: 700, letterSpacing: "0.06em",
  };
}

// ─── デスクトップ横長時、余白に配置する補助情報カード（連勝ストリーク等） ───
// 横長の画面で左右に生まれる余白を、補助情報の置き場として使う。
// 境界線で囲わず、SURFACE.cardの明度差だけで浮き上がらせる。
export function AuxStatCard({ label, value, color = GILT.bright, Icon }) {
  // 負の値は警告色にする（いま渡している値はどれも0以上で、CHIPも0未満にはならない）。
  // valueは数値・toLocaleString()済み文字列のどちらでも渡されるため、両方に対応させる。
  const numValue = typeof value === "number" ? value : parseFloat(value);
  const displayColor = !Number.isNaN(numValue) && numValue < 0 ? PENALTY_RED : color;
  return (
    <div style={{
      background: SURFACE.card, borderRadius: RADIUS.md, padding: "10px 12px",
      border: `1px solid ${SURFACE.hairlineWarm}`,
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 5,
        fontSize: 10, letterSpacing: "0.08em", color: SURFACE.textMuted,
      }}>
        {Icon && <Icon size={12} style={{ color: displayColor, opacity: 0.85 }} />} {label}
      </div>
      <div style={numeralStyle(18, displayColor)}>{value}</div>
    </div>
  );
}

// ─── 補助列の「ブラケット」パネル(AuxHintPanel)は削除 ───
// 中身が "勝者卓 ・ Round 1" で、**ヘッダー左端の "勝者卓 R1" と一字一句同じ情報**だった。
// しかもヘッダー側はモバイルでも出るのに対しこちらはデスクトップ限定なので、消すべきは
// こちら。結果として補助列の役目は「どの札がまだ残っているか」ひとつに絞られる。

// ─── 対戦画面の共通chrome：ヘッダー情報バー＋自分/相手パネル＋VS中央（.kj-battle-layout） ───
// CPU練習(battle/PracticeMatch.jsx)とオンライン対戦(battle/OnlineMatch.jsx)で
// ほぼ同一だったJSXをここに集約し、両モードの見た目がズレないようにする。
// 判定ロジック・フェーズ管理は一切持たない、純粋な表示コンポーネント。
// 対戦相手のアバター。以前は自分=SunglassesIcon(サングラスの顔＝😎の描き起こし)、
// CPU=RobotIcon、人間の対戦相手=PersonIcon という3種類の絵柄を出し分けていたが、
//  (1) 絵文字をそのままSVGにしただけの意匠で、カード/卓の世界観から浮いていた
//  (2) **ロボットのアイコンが「この相手はCPUだ」と一目で明かしていた**（オンライン対戦は
//      人数が足りない枠をCPUで自動補完する設計なので、この表示は席の埋め方を露出させる）
// という2つの問題があった。名前の頭文字を金の縁のメダイヨンに刻む形に統一し、
// 誰であれ同じ体系で表示する（＝相手が人間かCPUかを見た目からは区別できない）。
export function AvatarMonogram({ name, size = 32, tone = "opponent" }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const isSelf = tone === "self";
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: isSelf
        ? "radial-gradient(circle at 32% 26%, #2b2313, #120d07)"
        : "radial-gradient(circle at 32% 26%, #1e1a14, #0c0a08)",
      border: `1px solid ${isSelf ? GILT.base : SURFACE.hairlineWarm}`,
      boxShadow: isSelf
        ? "0 0 8px rgba(202,164,82,0.22), inset 0 1px 0 rgba(255,255,255,0.08)"
        : "inset 0 1px 0 rgba(255,255,255,0.05)",
      color: isSelf ? GILT.bright : GILT.ivory,
      fontFamily: FONT.display, fontWeight: 700, fontSize: Math.round(size * 0.42), lineHeight: 1,
      userSelect: "none",
    }}>{initial}</div>
  );
}


export function BattleScreenChrome({
  headerLeft, headerRight, showTimer, timerSeconds, timerTotal = 30,
  // ヘッダーの直下・**盤面の外**に敷く帯（進捗表）。盤面の中に入れると3Dのcanvas(inset:0)と
  // 重なるので、卓が使える縦幅を three/layoutAnchors.js にも教える必要が出てしまう。
  // 外に置けば .kj-battle-layout が flex:1 で残りを取るだけで済み、3D側は何も知らなくてよい。
  scoreboard,
  auxLeft, auxRight, self, opponent, actionContent, kjMode, resultFx, dealKey,
  // 決着したポットを勝者へ寄せる（"self" | "opp"）。素通しするだけで、判断は呼び出し側が持つ。
  potWinner = null,
  // overlay: 投影済みの画面座標(screenLayout)を受け取って卓の上に好きな物を置ける差し込み口。
  // 山札と持ちチップが消えて空いた区画に灯り(ライフ)を置くので、その座標が要る。
  overlay,
}) {
  const isDesktop = useIsDesktop();
  // 3D主導レイアウト: three/BattleScene3D.jsxのAnchorProjector(three/screenProjection.jsx)が
  // 固定ワールド座標(three/layoutAnchors.js)をカメラ投影した結果を(実質的な変化がある時だけ)
  // 報告してくる。卓の上に重ねるものはこの座標を絶対配置で追従する(旧DOMアンカー方式の完全な逆)。
  const [screenLayout, setScreenLayout] = useState(null);
  return (
    <>
      {/* **このヘッダーは対戦画面で唯一「削れば卓が大きくなる」帯**（盤面はflex:1で残り高さを
          取るため、ヘッダーを1px薄くすると卓の使える縦幅がそのまま1px増える）。載せてよいのは
          「今の一手では変えられないが、常に知っていたい情報」だけに絞ること。 */}
      <div className="kj-battle-header">
        {/* 左右にflex:1を等分させて中央を「本当に真ん中」に置く。space-betweenだけだと、
            片側が空のとき中央の要素がもう片方の文字数ぶんずれる。 */}
        <div style={{ flex: "1 1 0", fontSize: 11, color: SURFACE.textMuted, minWidth: 0 }}>{headerLeft}</div>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
          minHeight: 30, flexShrink: 0,
        }}>
          {showTimer && <CountdownRing seconds={timerSeconds} total={timerTotal} size={34} />}
        </div>
        <div style={{ flex: "1 1 0", fontSize: 11, color: SURFACE.textMuted, textAlign: "right", minWidth: 0 }}>{headerRight}</div>
      </div>

      {scoreboard}

      {/* 補助列は左右とも用意してあるが、中身を入れるかは呼び出し元が決める。
          **トラックは必ず左右対称に残すこと**——片側だけにすると卓の中心が画面中心から
          補助列の半分ぶんずれ、卓が寄って見える（実際に踏んだ）。両方とも空なら
          トラック自体を畳んで卓に幅を返す（`--wide`。片方だけ空、は作れない形にしてある）。 */}
      <div className={`kj-battle-layout${auxLeft || auxRight ? "" : " kj-battle-layout--wide"}`} style={{ padding: "10px 12px" }}>
        {auxLeft && <div className="kj-aux-left">{auxLeft}</div>}
        {/* 卓の見た目は3D側のTable3Dが担うので、kj-felt-panelのグラデーション背景と
            金/黒の二重リングboxShadowはインラインstyleで打ち消す（打ち消さないと旧CSSの卓と
            Table3Dの卓が二重に見える。実際に踏んだ不具合）。 */}
        <div className="kj-battle-field kj-felt-panel" style={{
          borderRadius: RADIUS.md, padding: 12,
          background: "rgba(8,10,18,0.4)", border: "none", boxShadow: "none",
          animation: resultFx ? "battleShakeNeutral 0.5s ease" : "none",
        }}>
          {/* 1画面につき1つの共有Canvas/シーンに全オブジェクトをまとめる（WebGLコンテキスト数の
              上限に触れないため）。pointerEvents:noneにして下のドックのクリック判定を妨げない。 */}
          <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", borderRadius: RADIUS.md, overflow: "hidden" }}>
            {/* 3Dチャンクの読み込み待ちは何も出さない。ドックのボタンは3Dと無関係に即操作できるので、
                ここで待機表示を出して気を散らす必要がない。 */}
            <Suspense fallback={null}>
              <BattleScene3D
                isDesktop={isDesktop} self={self} opponent={opponent} kjMode={kjMode}
                cardTheme={getEquippedSkin()} tableTheme={getEquippedTable()}
                onLayout={setScreenLayout} dealKey={dealKey} potWinner={potWinner}
              />
            </Suspense>
          </div>
          {/* 勝敗そのものの演出は勝ち/負けで色分けしない（あえて同一のニュートラルな黒フラッシュ）。
              色による感情演出はライフの増減の表示に集約する。 */}
          {resultFx && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", borderRadius: RADIUS.md,
              background: "radial-gradient(circle at 50% 50%, rgba(0,0,0,0.6), transparent 70%)",
              animation: "neutralFlash 0.55s ease",
            }} />
          )}

          {/* 卓の上に重ねるものは、canvasのラッパーと**全く同じ position:absolute; inset:0** に置く。
              screenLayoutの座標はcanvas自身のgetBoundingClientRect()基準なので、別の矩形
              (通常フローの子要素など)に同じ数値を当てると常に一定量ずれる（実際に踏んだ不具合）。 */}
          <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
            {screenLayout && overlay?.(screenLayout)}
          </div>

          {/* 卓の縦幅ぶんの空間を通常フローで確保するためだけの透明スペーサー
              (.kj-action-dockが正しい位置に来るようmin-heightだけを使う)。 */}
          <div className="kj-table-seats" />

          {/* 操作エリアを盤面の外に置くと、フェーズごとに中身の高さが変わって卓の位置がガタつく。
              同じフェルト盤面の内側に**固定高さ**のドックとして埋め込むことで、盤面の高さは常に一定。 */}
          <div className="kj-action-dock" style={{ position: "relative", zIndex: 1 }}>{actionContent}</div>
        </div>

        {auxRight && <div className="kj-aux-right">{auxRight}</div>}
      </div>
    </>
  );
}

// ─── 実績由来+ショップ/ボックス由来の称号を1つのリストから選ばせる共通部品 ───
// SkinScreen(スキン>称号タブ)とホーム画面から開く称号選択オーバーレイの両方から使う
// （見た目・選択ロジックを重複実装しない）。
export function TitleList({ equippedTitleLabel, onEquip, achievements, unlockedAchievementIds, cosmeticTitles, ownedTitleIds, rarityColor }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button onClick={() => onEquip(null)} className="kj-pressable" style={{
        textAlign: "left", padding: "10px 14px", borderRadius: RADIUS.sm,
        border: !equippedTitleLabel ? "1px solid #e8c874" : `1px solid ${SURFACE.hairlineStrong}`,
        background: !equippedTitleLabel ? "#e8c87411" : SURFACE.card, color: "#cfc3ae", cursor: "pointer", fontSize: 12,
      }}>称号なし</button>

      {/* 未解放の実績は名前を伏せ、代わりに**達成条件(desc)を出す**。
          称号の一覧は「今つけられる札」であると同時に「次に何を狙うか」の一覧でもあるのに、
          伏せ字だけを並べると後者が完全に失われる（実績が増えるほど同じ行が増えるだけになる）。
          descはこれまでどの画面にも出ていなかったデータなので、ここが唯一の出口になる。 */}
      {achievements.map(a => {
        const unlocked = unlockedAchievementIds.includes(a.id);
        return (
          <button key={a.id} onClick={() => unlocked && onEquip(a.title)} className="kj-pressable" style={{
            textAlign: "left", padding: "10px 14px", borderRadius: RADIUS.sm,
            border: equippedTitleLabel === a.title ? "1px solid #e8c874" : `1px solid ${unlocked ? SURFACE.hairlineStrong : "#2a2a2a"}`,
            background: equippedTitleLabel === a.title ? "#e8c87411" : SURFACE.card,
            color: unlocked ? "#f4e7bf" : "#555", cursor: unlocked ? "pointer" : "default",
            opacity: unlocked ? 1 : 0.75, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
          }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 12 }}>{unlocked ? a.title : "？？？"}</span>
              {!unlocked && <span style={{ fontSize: 10, color: SURFACE.textMuted }}>{a.desc}</span>}
            </span>
            <span style={{ fontSize: 9, color: "#777", flexShrink: 0 }}>{unlocked ? "実績" : "未達成"}</span>
          </button>
        );
      })}

      {/* コスメ称号は未所持でも**名前を出す**。ショップの棚に並べば結局そこで名前が見える以上、
          ここだけ伏せても秘密にはならず、「何が買えるのか」が分からなくなるだけで損しかない
          （実績と違って達成条件が無いので、伏せると行から読み取れる情報がゼロになる）。 */}
      {Object.entries(cosmeticTitles).map(([id, t]) => {
        const unlocked = ownedTitleIds.includes(id);
        return (
          <button key={id} onClick={() => unlocked && onEquip(t.label)} className="kj-pressable" style={{
            textAlign: "left", padding: "10px 14px", borderRadius: RADIUS.sm,
            border: equippedTitleLabel === t.label ? "1px solid #e8c874" : `1px solid ${unlocked ? SURFACE.hairlineStrong : "#2a2a2a"}`,
            background: equippedTitleLabel === t.label ? "#e8c87411" : SURFACE.card,
            color: unlocked ? "#f4e7bf" : "#6c6459", cursor: unlocked ? "pointer" : "default",
            opacity: unlocked ? 1 : 0.75, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 12 }}>{t.label}</span>
            <span style={{ fontSize: 9, color: unlocked ? rarityColor[t.rarity] : "#777", flexShrink: 0 }}>{unlocked ? "獲得済み" : "未所持"}</span>
          </button>
        );
      })}
    </div>
  );
}
