import { RADIUS, SURFACE, FONT, AuxStatCard, ScreenAmbientGlow, RankProgressPanel, numeralStyle } from "../shared.jsx";
import { getMatchHistory, getRankRp } from "../storage.js";
import { ONLINE_ENABLED } from "../features.js";
import FireIcon from "../icons/FireIcon.jsx";
import TrophyIcon from "../icons/TrophyIcon.jsx";
import ChevronLeftIcon from "../icons/ChevronLeftIcon.jsx";

// キャリア画面。ホームの RECORD パネルの「戦績」から開く全面オーバーレイ（履歴カードと戦績の集計）。

// hint を渡すとホバーで意味が出る（`.kj-hint`）。
// **バッジの字そのものは短いままにすること**——意味を字で書き足すと、履歴が1行の記号列
// ではなく文章の列になり、一覧として読めなくなる。説明はホバーの中だけに置く。
function StatBadge({ label, color, hint }) {
  return (
    <span className={hint ? "kj-hint" : undefined} data-hint={hint} style={{
      fontSize: 10, color, background: `${color}1a`, border: `1px solid ${color}55`,
      borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

// 履歴カードの勝敗の色。**KING/JOKER の宣言カード（`CardArt.jsx` の `frameColor`）と同じ値を使う**
// 。
// 進捗表の細線（`battle/components.jsx`）と `BetActionPanel` の fold=赤 / call=緑 も同じ対応で、
// このゲームでは緑と赤が既に「総取りの向き」という意味を運んでいる。**新しい緑や赤を作らないこと**
// ——同じ意味の色が画面に2種類できる。金は通貨（CHIP）の色として報酬の側に残す。
const WIN_GREEN = "#4ade80";
const LOSE_RED = "#f87171";

// キャリア画面：この端末に残った自分自身の記録だけを出す。
// **偽の他プレイヤーは1人も出さないこと**——サーバー側にDB永続化が無い以上、実在しない
// スコアを「グローバルランキング」であるかのように見せるのは嘘になる（既存の確定方針）。
export function RankingScreen({ onBack }) {
  const all = getMatchHistory();
  const history = all.slice(0, 15);
  const wins = all.filter((h) => h.won).length;
  const rate = all.length > 0 ? Math.round((wins / all.length) * 100) : 0;

  return (
    // **奥のロビーを透かす**。不透明な板で覆うと、全面オーバーレイなのにどこに居るのか分からなくなる。
    // 背景そのものは `.kj-lobby-bg`（外枠の直下）が描いているので、ここは透かしてぼかすだけでよい。
    <div style={{
      position: "relative", height: "100%", overflow: "hidden",
      display: "flex", flexDirection: "column",
      // **自前の backdrop-filter は持たない／`height: 100%` で積まない**（理由は実績一覧の注記）。
      // 幕が部屋をぼかし、ロビーの中身は開いている間だけ App が隠すので、ここは濃さを足すだけでよい。
      background: "rgba(11,8,6,0.45)",
    }}>
      <ScreenAmbientGlow />
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 16px 0", position: "relative", flexShrink: 0 }}>
        <button onClick={onBack} className="kj-pressable" aria-label="戻る" style={{
          background: SURFACE.card, border: "none", borderRadius: RADIUS.sm,
          width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          color: "#f4e7bf", cursor: "pointer", flexShrink: 0,
        }}><ChevronLeftIcon size={18} /></button>
        <div style={{ fontFamily: FONT.display, fontSize: 20, color: "#e8c874", display: "flex", alignItems: "center", gap: 8 }}>
          <TrophyIcon size={20} /> キャリア
        </div>
      </div>
      {/* **この画面だけ列を広く取る**。
          履歴カードは3列（何の試合か／スコア／報酬）なので、既定の640では左のバッジと中央の数字が
          詰まって、1枚のカードの情報量が多く見えていた。広げるのはこの画面だけ——一覧を読む画面と
          設定のような「列を絞って中央に置く」画面では、必要な幅が違う。 */}
      <div className="kj-page-scroll" style={{
        flex: 1, minHeight: 0, overflowY: "auto", position: "relative",
        maxWidth: 820, width: "100%", margin: "0 auto",
      }}>
        {/* 段位が動くのはランクマッチだけ。常設の現在地はここに置く——ホーム画面には出さない
            （情報量を絞った際の「消すのではなく本来の置き場所へ戻す」方針）。
            オンラインを出さない提出版（features.js）では、動く手段が無いので出さない。 */}
        {ONLINE_ENABLED && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: SURFACE.textMuted, marginBottom: 6 }}>段位</div>
            <RankProgressPanel totalRp={getRankRp()} />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          <AuxStatCard label="戦績" value={`${wins}勝 ${all.length - wins}敗`} color="#e8c874" Icon={TrophyIcon} />
          <AuxStatCard label="勝率" value={`${rate}%`} color="#e8c874" Icon={FireIcon} />
        </div>

        {history.length === 0 ? (
          <div style={{ textAlign: "center", color: "#6b6154", fontSize: 13, padding: "24px 0" }}>
            まだ記録がない。
          </div>
        ) : history.map((h, i) => {
          // 勝敗の色は語とスコアで共有する。**別の色にしないこと**——同じ1つの結果が
          // 2つの意味に割れて見える。
          const tone = h.won ? WIN_GREEN : h.draw ? "#9aa0ac" : LOSE_RED;
          return (
            // 3列（左＝何の試合か／中央＝スコア／右＝報酬）。**左右を flex:1 で等分し、
            // スコアだけを縮まない列にする**ので、中央は左の情報量に関わらず必ず真ん中に来る。
            // **日付は出さない**。直近の数試合を並べるだけの表で、
            // 縦に1行使うほどの手掛かりではない——順序そのものが既に「いつ」を言っている。
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 16px", marginBottom: 8, borderRadius: RADIUS.md,
              // 下地も勝敗の色で染める（縁だけだと、並べたときに勝ち負けが札単位で読めない）。
              // **負けにも縁を与える。** 勝ちだけを縁取っていた頃の名残で負けが無地だったが、
              // 赤で呼ぶと決めた以上、負けた試合も1枚の札として同じ強さで立つ必要がある。
              background: h.draw ? SURFACE.card : h.won ? "#0f2417" : "#2a1214",
              border: h.draw ? "none" : `1px solid ${tone}`,
            }}>
              {/* 左：何の試合だったか。**左揃え**。
                  局の中身を1行のバッジで見せる。**「何が起きた試合だったか」が思い出せること**が
                  この行の役目で、勝敗そのものは中央が既に言っている。 */}
              <div style={{
                flex: 1, minWidth: 0,
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#f4e7bf" }}>
                  {h.online ? (h.mode === "ranked" ? "ランクマッチ" : "カジュアル") : "CPU練習"}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {/* ライフの内訳は中央のスコアが出しているので、ここには置かない（二重になる）。 */}
                  <StatBadge label={`${h.roundsPlayed ?? 0}局`} color="#9aa0ac" hint="この試合で打った局の数" />
                  {h.foldsWon > 0 && <StatBadge label={`降ろした ${h.foldsWon}`} color="#e8c874" hint="相手を降ろしてポットを取った回数" />}
                  {h.suddenDeath && <StatBadge label="サドンデス" color="#B06BFF" hint="ライフが同数のまま上限に達し、1局だけ延長した" />}
                  {h.queenWin && <StatBadge label="Queen" color="#F2C230" hint="Queen を出して局を制した" />}
                  {h.oneEatsTen && <StatBadge label="Ⅰ＞Ⅹ" color="#4ade80" hint="I で X を食った" />}
                  {h.queenSlain && <StatBadge label="Queen撃破" color="#4ade80" hint="I で相手の Queen を討ち取った" />}
                </div>
              </div>
              {/* 中央：**残りライフをそのまま試合のスコアとして大きく出す**（対戦ゲームの戦績でよくある、
                  勝敗の語の下にラウンド数「4 - 13」が入る形）。
                  ライフはゼロサムなので和が常に一定＝そのまま点差として読める数で、しかも
                  勝敗の語だけでは「どういう試合だったか」が何も残らない。 */}
              <div style={{ flexShrink: 0, textAlign: "center", padding: "0 6px" }}>
                <div style={{
                  ...numeralStyle(10, tone, 800), letterSpacing: "0.16em", opacity: 0.85,
                }}>{h.draw ? "DRAW" : h.won ? "WIN" : "LOSE"}</div>
                <div style={{
                  ...numeralStyle(26, tone, 900), lineHeight: 1.05, marginTop: 2, whiteSpace: "nowrap",
                }}>{h.livesLeft ?? 0} - {h.opponentLives ?? 0}</div>
              </div>
              {/* 右：報酬。左と同じ flex:1 で受けて、中央を押しのけないようにする。 */}
              <div style={{
                ...numeralStyle(14, "#e8c874", 800), flex: 1, textAlign: "right",
              }}>+{h.reward ?? 0}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
