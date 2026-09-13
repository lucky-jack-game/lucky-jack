// 1対1の対戦の専用UI部品。既存の shared.jsx を置き換えるものではなく、
// **このルールで新しく必要になった3つ**（灯り／UP-DOWNの公表／手札2枚からの選択）だけを持つ。
// 枠・ボタン・書体は引き続き shared.jsx のトークンを使う（画面ごとに違う意匠を作らない）。
import { useEffect } from "react";
import { PlayingCard } from "../CardArt.jsx";
import { playCardFlip, playWin, playLose } from "../audio/sfx.js";
import { triggerHaptic } from "../audio/engine.js";
import { FONT, GILT, SURFACE, PENALTY_RED, CHIP_GOLD, numeralStyle } from "../shared.jsx";

// サーバーから来るカード（{id, kind:"number"|"queen", number}）を PlayingCard のpropsへ。
// **Queenの内部識別子は "king" のまま**なので、ここを取り違えると別の札が出る
// （CardArt.jsx の special="king" が Queen、declaration="king" が KING宣言カード）。
export function cardToProps(card) {
  if (!card) return null;
  if (card.kind === "queen") return { variant: "number", number: 10, special: "king" };
  return { variant: "number", number: card.number };
}

// ─── 灯り（ライフ） ───
// 人型の人形は使わない（このゲームの語彙は金・象牙・フェルト・
// 緑青・紫水晶で、人物表現を一つも持っていない）。**消えた数がそのまま残機**で、
// 暗くなっていく側が負けている側、というのが説明を要らなくする。
// lit … 現在の残りライフ。**賭けている分もここに含まれている**（サーバーはライフを決着時にしか
//        動かさないため）。staked を別に足すと灯りが増えてしまう（実際に6ライフで7個表示された）。
// staked … そのうち今このポットに出ている数。灯りを増やすのではなく、**後ろから順に暗く**する。
export function LifeLights({ total, lit, size = 13, gap = 4, tone = "self", staked = 0 }) {
  const color = tone === "opp" ? "#B06BFF" : CHIP_GOLD;
  const held = Math.max(0, lit - staked);
  return (
    <div style={{ display: "flex", gap, alignItems: "center", flexWrap: "wrap", maxWidth: size * 8 + gap * 7 }}>
      {Array.from({ length: Math.max(total, lit) }, (_, i) => {
        const isLit = i < held;
        const isStaked = !isLit && i < lit;
        return (
          <span key={i} title={isLit ? "残りライフ" : isStaked ? "賭けているライフ" : "失ったライフ"}
            style={{
              width: size, height: size, borderRadius: "50%", display: "inline-block",
              background: isLit
                ? `radial-gradient(circle at 35% 30%, #fff8e0, ${color} 55%, rgba(0,0,0,0.4) 100%)`
                : isStaked ? "rgba(120,100,60,0.35)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${isLit ? color : isStaked ? GILT.dim : "rgba(255,255,255,0.10)"}`,
              // 灯っているものだけが光を持つ。消えた灯りは枠だけ残して「そこにあったこと」を示す。
              boxShadow: isLit ? `0 0 ${size * 0.7}px ${color}, inset 0 0 3px rgba(255,255,255,0.6)` : "none",
            }}
          />
        );
      })}
    </div>
  );
}

// ─── UP / DOWN の公表 ───
// 毎局、両者の手札2枚の内訳が公表される。**このゲームで唯一の、相手についての確かな情報**。
export function BandBadge({ bands, label, dim = false }) {
  if (!bands) return null;
  const cell = (kind, n) => (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 6px", borderRadius: 4,
      background: n > 0 ? (kind === "UP" ? "rgba(89,162,141,0.18)" : "rgba(176,107,255,0.16)") : "rgba(255,255,255,0.04)",
      border: `1px solid ${n > 0 ? (kind === "UP" ? "#59A28D" : "#B06BFF") : "rgba(255,255,255,0.08)"}`,
      opacity: n > 0 ? 1 : 0.4,
    }}>
      <span style={{ fontFamily: FONT.display, fontSize: 9, letterSpacing: "0.08em", color: kind === "UP" ? "#7FD6BC" : "#CFA6FF" }}>{kind}</span>
      <span style={numeralStyle(11, GILT.ivory, 800)}>{n}</span>
    </span>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, opacity: dim ? 0.75 : 1 }}>
      {label && <span style={{ fontSize: 9, color: SURFACE.textMuted, whiteSpace: "nowrap" }}>{label}</span>}
      {cell("UP", bands.up)}
      {cell("DOWN", bands.down)}
    </div>
  );
}

// UP/DOWNの公表を**ランプ2つずつ**で出す（UPが左・DOWNが右）。
// 手札は常に2枚なので up+down は必ず2。数字を読むより「いくつ点いているか」を見る方が速い。
//
// **数を字で書かないこと。** 字にすると読み取りに一拍かかるうえ、席の枠に入れるには
// 「UP 1」「DOWN 1」と2語ずつ要る。点/消は形そのものが数なので、目を止めずに読める。
const BAND_TONE = {
  up: { on: "#7FD6BC", edge: "#59A28D" },
  down: { on: "#CFA6FF", edge: "#B06BFF" },
};
function LampPair({ kind, n, size }) {
  const t = BAND_TONE[kind];
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {[0, 1].map((i) => {
        const on = i < (n ?? 0);
        return (
          <span key={i} style={{
            width: size, height: size, borderRadius: "50%", display: "inline-block",
            background: on ? t.on : "transparent",
            border: `1px solid ${on ? t.on : "rgba(255,255,255,0.16)"}`,
            boxShadow: on ? `0 0 ${size * 0.8}px ${t.edge}` : "none",
          }} />
        );
      })}
    </span>
  );
}

// UP/DOWNの公表を**それ自体で1つの表**として出す（進捗表とは分ける）。
// UPが左・DOWNが右、それぞれランプ2つ。手札は常に2枚なので up+down は必ず2で、
// **点/消の形そのものが数**になる——字で書くと読み取りに一拍かかる。
// 見出しの UP / DOWN は表の列名として残す（左右の並びだけで意味を覚えさせない）。
export function BandLamps({ bands, size = 8 }) {
  const col = (kind, label, n) => (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span style={{
        fontFamily: FONT.display, fontSize: 7, letterSpacing: "0.1em", fontWeight: 700,
        color: BAND_TONE[kind].on, opacity: 0.75,
      }}>{label}</span>
      <LampPair kind={kind} n={n} size={size} />
    </span>
  );
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 8 }}>
      {col("up", "UP", bands?.up)}
      {col("down", "DOWN", bands?.down)}
    </span>
  );
}

// 席の現況——**残りライフとUP/DOWNだけ**。名前も履歴もここには置かない（進捗表が持つ）。
// 卓の外（相手は上・自分は下）に置くので、どちらのものかは**位置が言う**。
//
// **残りライフの数はここにしかない。** 卓の上からは灯りを外した（賭けた分だけが卓に乗る）ので、
// 何ライフ残っているかを言うのはこの数字だけになった。賭けている分は括弧で添える。
export function SeatStatus({ lives, staked = 0, bands, tone = "self" }) {
  const color = tone === "self" ? CHIP_GOLD : "#B06BFF";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 12,
      padding: "4px 12px", borderRadius: 999,
      background: "rgba(8,6,4,0.72)",
      border: `1px solid ${tone === "self" ? GILT.dim : "rgba(176,107,255,0.3)"}`,
      whiteSpace: "nowrap",
    }}>
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
        <span style={numeralStyle(17, color, 900)}>{lives}</span>
        <span style={{ fontSize: 9, color: SURFACE.textMuted }}>ライフ</span>
        {staked > 0 && <span style={numeralStyle(10, GILT.base, 700)}>-{staked}</span>}
      </span>
      <BandLamps bands={bands} />
    </div>
  );
}

// ─── 進捗表（サッカーのPK戦の表と同じ読み方） ───
// 縦3行（ラウンド番号 / 自分が出した札 / 相手が出した札）× 横は名前＋ラウンド数ぶん。
// **未消化のラウンドも枠だけ出す**——PK戦のスコアボードが5本ぶんの枠を最初から並べるのと
// 同じで、そうしないと「あと何局あるか」＝進捗が読めない（この表の存在理由そのもの）。
//
// **札はアラビア数字で書く。** カードの絵はローマ数字だが、ランクは15局あり、モバイル幅では
// 1マス19px程度しか取れない——"VIII"はどう詰めても入らないが"10"なら必ず入る。
// スコアボードはカードアートではなく数表なので、読めることを優先する。
//
// 金の枠は**ポットを取った側**（＝ライフが動いた側）。カードの勝敗ではないので、JOKERの局では
// 弱い方の札に金が付く——ラウンド番号の下の細い線（緑=KING / 赤=JOKER）がその理由を示す。
const cellFace = (card) => {
  if (!card) return "";
  if (card.kind === "queen") return "Q";
  return String(card.number ?? "");
};

export function RoundScoreboard({ selfName, opponentName, totalRounds = 0, currentRound = 0, log = [] }) {
  const rounds = Math.max(totalRounds, log.length, currentRound);
  const cols = Array.from({ length: rounds }, (_, i) => log[i] ?? null);

  const cell = (entry, mine) => {
    const won = entry && (mine ? entry.youWonPot : !entry.youWonPot);
    const face = entry && cellFace(mine ? entry.yourCard : entry.opponentCard);
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: 22, borderRadius: 3,
        border: `1px solid ${won ? GILT.bright : "rgba(255,255,255,0.07)"}`,
        background: won ? "rgba(232,200,116,0.14)" : "rgba(255,255,255,0.02)",
        boxShadow: won ? `0 0 6px rgba(232,200,116,0.35)` : "none",
        ...numeralStyle(12, entry ? (won ? GILT.bright : GILT.ivory) : "transparent", won ? 900 : 700),
      }}>{face || "・"}</div>
    );
  };

  // **名前だけを置くこと。** 残りライフとUP/DOWNは卓の外の SeatStatus が持つ。
  // この表が担うのは「どの局に何を出したか」——1局ごとに1回しか変わらない記録で、
  // 毎ターン動く現況（ライフ・公表）とは読む速さが違う。同じ枠に混ぜると、
  // 変わらないものを何度も見に行くことになる。行の色だけは現況の側と揃える。
  const nameCell = (name, tone) => (
    <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, paddingRight: 6 }}>
      <span style={{
        width: 4, height: 4, borderRadius: "50%", flexShrink: 0,
        background: tone === "self" ? CHIP_GOLD : "#B06BFF",
      }} />
      <span style={{
        fontSize: 11, color: GILT.ivory, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{name}</span>
    </div>
  );

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `minmax(72px, 96px) repeat(${rounds}, minmax(0, 1fr))`,
      gap: 2, alignItems: "stretch",
      // 卓(.kj-battle-layout)と同じ上限で中央に置く。**外して画面幅いっぱいに伸ばさないこと**
      // ——広いモニタで表だけが卓の倍の幅になり、同じ試合の話をしているように見えなくなる。
      maxWidth: 1100, margin: "0 auto", width: "100%",
      padding: "5px 10px 6px",
      background: "rgba(8,6,4,0.55)",
      borderBottom: `1px solid ${GILT.dim}`,
    }}>
      {/* 左上は空欄（表の隅） */}
      <div />
      {cols.map((entry, i) => {
        const n = i + 1;
        const now = n === currentRound && !entry;
        return (
          <div key={`h${n}`} style={{ textAlign: "center", paddingBottom: 1 }}>
            <div style={numeralStyle(9, now ? GILT.bright : entry ? SURFACE.textMuted : "rgba(255,255,255,0.22)", now ? 900 : 700)}>{n}</div>
            {/* KING=緑 / JOKER=赤。**BetActionPanelとCardArtの宣言カードと同じ対応**なので、
                色が意味を運ぶ（金の枠が弱い札に付いている理由がこの線だけで分かる）。 */}
            <div style={{
              height: 2, borderRadius: 1, marginTop: 1,
              background: entry ? (entry.kjMode === "king" ? "#4ade80" : "#f87171") : "transparent",
            }} />
          </div>
        );
      })}

      {/* **既定名のまま遊ぶ人が多いので、両方「プレイヤー」になりうる。** 相手と同じ名前に
          なったときだけ自分の行を「あなた」にする（色の点だけが手掛かりの表になるのを防ぐ）。 */}
      {nameCell(selfName && selfName === opponentName ? "あなた" : selfName, "self")}
      {cols.map((e, i) => <div key={`s${i}`}>{cell(e, true)}</div>)}

      {nameCell(opponentName, "opp")}
      {cols.map((e, i) => <div key={`o${i}`}>{cell(e, false)}</div>)}
    </div>
  );
}

// ─── 手札2枚から1枚を選ぶ ───
// **旧仕様に無かった意思決定そのもの**（旧作はカードが1枚ランダムに配られるだけで、
// 局中の判断は「いくら賭けるか」しか無かった）。使わなかった1枚は手元に残るので、
// 「どちらを温存するか」が次の局の公表に効いてくる。
// highlightId: 実践チュートリアルが「今どれを押すか」を指し示すために使う（KJChoicePanel /
// BetActionPanel の `highlight` と同じ作法）。**渡さなければ従来と完全に同じ挙動**なので、
// 本番の呼び出し元は何も変えなくてよい。説明用の偽カードや矢印を別に描かないこと——
// そこで覚えた位置は本番に転移しない。
export function HandPicker({ hand = [], onPick, picked = null, enabled = false, width = 62, highlightId = null }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center" }}>
      {hand.map((c) => {
        const isPicked = picked && picked.id === c.id;
        return (
          <button key={c.id} type="button"
            className={`kj-pressable${highlightId === c.id ? " kj-spotlight" : ""}`}
            onClick={() => enabled && onPick?.(c)} disabled={!enabled}
            style={{
              background: "none", border: "none", padding: 0, cursor: enabled ? "pointer" : "default",
              // 選んだ1枚だけを持ち上げる。**選択後に他方を消さない**——手元に残る札が何かは
              // 次の局の公表に直結する情報なので、隠すと読み合いの材料が減る。
              transform: isPicked ? "translateY(-8px)" : "none",
              filter: picked && !isPicked ? "grayscale(0.5) brightness(0.6)" : "none",
              transition: "transform 0.18s ease, filter 0.18s ease",
              outline: isPicked ? `2px solid ${CHIP_GOLD}` : "none", outlineOffset: 3, borderRadius: 6,
            }}>
            <PlayingCard {...cardToProps(c)} width={width} />
          </button>
        );
      })}
    </div>
  );
}

// 局の結果を1行で言い切る。**「本戦の勝敗」と「ポットの勝敗」は別軸**で、JOKERでは反転するので、
// 片方だけ出すと嘘になる（旧実装で実際に混乱を招いた箇所と同じ構造）。
//
// **音はここで鳴らす。** この部品は開示フェーズの間だけ存在するので、マウント＝ちょうど
// 決着した瞬間になり、局番号を覚えたり前の値と比べたりする必要がない。
// （移行の途中でここが無音になっていた: 局のいちばんの見せ場が音を持たないまま出ていた。）
export function RoundVerdict({ reveal }) {
  const won = !!reveal?.youWonPot;
  const has = !!reveal;
  useEffect(() => {
    if (!has) return;
    playCardFlip();
    // 札がめくれ切ってから勝敗の音を重ねる（同時に出すと1つの雑音に潰れる）。
    const t = setTimeout(() => {
      if (won) playWin(0); else playLose();
      // 振動も音と同じ節目に置く（triggerHaptic 側が設定OFFと非対応端末を弾く）。
      triggerHaptic(won ? 18 : [22, 60, 22]);
    }, 260);
    return () => clearTimeout(t);
  }, [has, won]);

  if (!reveal) return null;
  const { youWonCard, youWonPot, folded, youFolded, livesMoved, kjMode } = reveal;
  return (
    <div style={{ textAlign: "center", lineHeight: 1.5 }}>
      <div style={{ fontFamily: FONT.display, fontSize: 15, fontWeight: 900, color: youWonPot ? CHIP_GOLD : PENALTY_RED }}>
        {youWonPot ? `+${livesMoved} ライフ` : `-${livesMoved} ライフ`}
      </div>
      {/* **降りて終わった局は、そのことを主役の行で言う**。10pxの薄字でカードの勝敗と同じ行に混ぜていた版は、
          いちばん知りたい「なぜ終わったのか」が、読み流される大きさで出ていた。
          カードの答え合わせは**降りた局でも必ず出す**ので、その下に小さく残す。 */}
      {folded ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: GILT.ivory }}>
            {youFolded ? "あなたが降りた" : "相手が降りた"}
          </div>
          <div style={{ fontSize: 10, color: SURFACE.textMuted }}>
            カードは{youWonCard ? "勝っていた" : "負けていた"}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 10, color: SURFACE.textMuted }}>
          {kjMode === "king" ? "KING" : "JOKER"}：カードは{youWonCard ? "勝ち" : "負け"}
        </div>
      )}
    </div>
  );
}
