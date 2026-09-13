// 1対1の対戦の**表示だけ**を持つコンポーネント。オンライン対戦(OnlineMatch.jsx)と
// CPU練習(PracticeMatch.jsx)がこれを共有する。
//
// 進行の実体は shared/match.js（サーバーもCPU練習も同じものを回す）、
// 見た目はここ、という2枚看板にしておけば「同じことを2箇所に書く」が起きない。
// **ここには一切ルールを書かないこと**——判定や次の一手を決める処理が紛れ込んだ瞬間に、
// オンラインとCPU練習で挙動が割れる余地ができる。
import { useEffect, useState } from "react";
import {
  BattleScreenChrome, KJChoicePanel, BetActionPanel, RankProgressPanel,
  FONT, GILT, SURFACE, CHIP_GOLD, PENALTY_RED, RADIUS, numeralStyle,
  goldBtnStyle, outlineBtnStyle,
} from "../shared.jsx";
import { PlayingCard } from "../CardArt.jsx";
import ChipIcon from "../icons/ChipIcon.jsx";
import BoxIcon from "../icons/BoxIcon.jsx";
import MedalIcon from "../icons/MedalIcon.jsx";
import { BOX_TYPES, getSettings } from "../storage.js";
import { playWin, playLose, playCoin, playNotify } from "../audio/sfx.js";
import { triggerHaptic } from "../audio/engine.js";
import { raiseCost as lifeRaiseCost, ANTE as BASE_ANTE } from "../../../shared/engine.js";
import { PHASE, potOf, betContext, bettingExhausted, anteOfRound } from "../../../shared/match.js";
// 進行の「間」の尺は shared/pacing.js ただ1つから配る（画面ごとに数字を書かない）。
import { POT_PAYOUT_MS } from "../../../shared/pacing.js";
// **three.js を持ち込まない純粋な定数モジュール**（three/dealTiming.js のコメント参照）。
// ここから three/Dispenser3D.jsx をimportすると、対戦しない人のメインバンドルにも3D一式が乗る。
import { dealtPerSide, selfCardLandsAt } from "../three/dealTiming.js";
import { LifeLights, HandPicker, RoundVerdict, RoundScoreboard, SeatStatus, cardToProps } from "./components.jsx";

// 0から目標まで数え上げる。
// **音と同じ拍で始めること**——コインの音（620ms）と数字が動き始める瞬間がずれると、
// 2つの別々の出来事に見える。終盤を緩めるので、最後の1枚が置かれる形で止まる。
// **モーション低減では最初から結果を出す**（動きの無い画面で数字だけ待たされるのは、
// 前庭系への配慮とは何の関係もないただの遅い画面。開封の850msと同じ扱い）。
function useCountUp(target, { ms = 900, delay = 0 } = {}) {
  const instant = getSettings().reduceMotion;
  const [v, setV] = useState(instant ? target : 0);
  useEffect(() => {
    if (instant) { setV(target); return undefined; }
    let raf = 0;
    let timer = 0;
    const run = () => {
      const t0 = performance.now();
      const tick = (now) => {
        const pr = Math.min(1, (now - t0) / ms);
        setV(Math.round(target * (1 - (1 - pr) ** 3)));
        if (pr < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    timer = setTimeout(run, delay);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [target, ms, delay, instant]);
  return v;
}

const REASON_TEXT = {
  knockout: "ライフを削り切った",
  roundLimit: "ラウンド上限・ライフ差で決着",
  suddenDeath: "サドンデスで決着",
  forfeit: "相手が退出した",
};

// モードの選択はここに置く。**ホームの扉を増やさないこと**——ファサードは「同じ大きさの扉2枚」で
// 主従を灯りだけで示す構成なので、3枚目を足すと左右対称が崩れる。ランク/カジュアルは
// 対戦の種類ではなく同じ対戦の長さ違いなので、キューに並ぶ画面で選ぶのが素直。
function ModeToggle({ mode, onChange }) {
  const item = (id, label, sub) => (
    <button key={id} type="button" className="kj-pressable" onClick={() => onChange(id)}
      style={{
        padding: "8px 16px", borderRadius: RADIUS.sm, cursor: "pointer",
        background: mode === id ? "rgba(202,164,82,0.16)" : "transparent",
        border: `1px solid ${mode === id ? GILT.base : GILT.dim}`,
        color: mode === id ? GILT.ivory : SURFACE.textMuted,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 96,
      }}>
      <span style={{ fontFamily: FONT.display, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ fontSize: 9 }}>{sub}</span>
    </button>
  );
  return (
    <div style={{ display: "flex", gap: 10 }}>
      {item("casual", "CASUAL", "6ライフ / 8局")}
      {item("ranked", "RANKED", "7ライフ / 15局")}
    </div>
  );
}

export function MatchLobbyView({ mode, waiting, isPractice, onStart, onCancel, onExit, onModeChange, notice }) {
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, height: "100%", justifyContent: "center" }}>
      {/* モードを選べる場面では見出しにモード名を出さない——真下のトグルが同じ言葉を言うので、
          「CASUAL / CASUAL」と二重に並ぶ（実際にそう出た）。選べない場面でだけ現在地を名乗る。 */}
      <div style={{ fontFamily: FONT.display, fontSize: 20, fontWeight: 900, color: GILT.ivory, letterSpacing: "0.1em" }}>
        {isPractice ? "PRACTICE" : onModeChange && !waiting ? "ONLINE" : mode === "ranked" ? "RANKED" : "CASUAL"}
      </div>
      {!waiting && onModeChange && <ModeToggle mode={mode} onChange={onModeChange} />}
      {waiting ? (
        <>
          <div style={{ color: SURFACE.textMuted, fontSize: 13, textAlign: "center", lineHeight: 1.7 }}>
            相手を探している…<br />
            {/* **CPUで埋めない**ので、実際に人が来るまで待つ。待つ理由はその一点だけなので、
                案内文ではなく事実を1行置く（見つからないときの出口は下の「戻る」）。 */}
            <span style={{ fontSize: 11 }}>CPUは入らない。</span>
          </div>
          <button type="button" className="kj-pressable" style={outlineBtnStyle()} onClick={onCancel}>キャンセル</button>
        </>
      ) : (
        <button type="button" className="kj-pressable" style={goldBtnStyle()} onClick={onStart}>
          {isPractice ? "CPUと対戦する" : "対戦相手を探す"}
        </button>
      )}
      {onExit && <button type="button" className="kj-pressable" style={outlineBtnStyle()} onClick={onExit}>戻る</button>}
      {notice && <div style={{ color: PENALTY_RED, fontSize: 12 }}>{notice}</div>}
    </div>
  );
}

// outcome: matchStats.js の finishMatch() が返す { reward, boxes, rank, unlocked }。
// **表示するだけで、ここでは何も確定させないこと**——通貨・実績・段位の書き込み口は
// finishMatch() ただ1つにしてある（画面が2つあるので、片方だけ直す事故を構造的に潰すため）。
export function MatchEndView({ ending, totalLives, outcome, onRestart, onExit }) {
  const label = ending.draw ? "引き分け" : ending.youWon ? "WIN" : "LOSE";
  // **試合の決着も音を持たせる。** 局の決着(RoundVerdict)には音があるのに試合の決着だけ
  // 無音だと、いちばん大きい区切りがいちばん静かになる。報酬のコイン音は勝敗音の後ろへずらす。
  const youWon = !!ending.youWon;
  // 報酬はコインの音と同じ 620ms から動き出す。**フックは条件付きで呼べない**ので、
  // outcome がまだ無い間も 0 を目標に呼んでおく。
  const rewardShown = useCountUp(outcome?.reward ?? 0, { delay: 620 });
  const unlockedCount = outcome?.unlocked?.length ?? 0;
  useEffect(() => {
    if (youWon) playWin(2); else playLose();
    triggerHaptic(youWon ? [30, 70, 30, 70, 60] : 40);
    const t = setTimeout(playCoin, 620);
    // 実績の解放は報酬を数え終えた後ろへずらす。**重ねないこと**——同時に出すと1つの音に
    // 潰れて、「報酬が出た」「実績が解放された」の2件だと分からなくなる。
    const t2 = unlockedCount > 0 ? setTimeout(playNotify, 1560) : 0;
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [youWon, unlockedCount]);
  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, height: "100%", justifyContent: "center" }}>
      <div style={{
        fontFamily: FONT.display, fontSize: 34, fontWeight: 900, letterSpacing: "0.12em",
        color: ending.youWon ? CHIP_GOLD : ending.draw ? GILT.ivory : PENALTY_RED,
      }}>{label}</div>
      <div style={{ color: SURFACE.textMuted, fontSize: 12 }}>{REASON_TEXT[ending.reason] || ""}</div>
      <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: SURFACE.textMuted, marginBottom: 4 }}>あなた</div>
          <LifeLights total={totalLives} lit={ending.yourLives} />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: SURFACE.textMuted, marginBottom: 4 }}>{ending.opponentName}</div>
          <LifeLights total={totalLives} lit={ending.opponentLives} tone="opp" />
        </div>
      </div>
      <div style={{ fontSize: 11, color: SURFACE.textMuted }}>{ending.roundsPlayed} 局</div>

      {outcome && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, minWidth: 220 }}>
          {/* 報酬は**負けても必ず出る**。数字だけでなく通貨名も添える（この画面で初めて
              CHIPを見る人が「何が増えたのか」を推測しなくて済むように）。 */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", borderRadius: RADIUS.sm,
            border: `1px solid ${GILT.dim}`, background: "rgba(8,6,4,0.55)",
          }}>
            <ChipIcon size={16} color={CHIP_GOLD} />
            <span style={{ ...numeralStyle(17, CHIP_GOLD, 800) }}>+{rewardShown}</span>
            <span style={{ fontSize: 10, color: SURFACE.textMuted }}>CHIP</span>
          </div>

          {/* 段位はランクマッチでのみ動く。バッジ単体では隣接段を見分けられないので、
              RankProgressPanel が必ずラベルとRPバーをセットで出す。 */}
          {outcome.rank && (
            <RankProgressPanel totalRp={outcome.rank.totalRp} delta={outcome.rank.delta}
              promoted={outcome.rank.promoted} demoted={outcome.rank.demoted} />
          )}

          {outcome.boxes?.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              {outcome.boxes.map((t) => (
                <span key={t} style={{
                  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11,
                  padding: "5px 10px", borderRadius: RADIUS.sm,
                  border: `1px solid ${GILT.base}`, color: GILT.ivory, background: "rgba(202,164,82,0.12)",
                }}>
                  <BoxIcon size={13} color={GILT.bright} />{BOX_TYPES[t]?.label || t}
                </span>
              ))}
            </div>
          )}
          {/* 開封はここでさせない——順位・報酬・実績で既に情報が多く、開封演出まで足すと
              いちばんの見せ場が埋もれる（ショップの「ボックス」タブで開ける）。 */}

          {/* **実績の解放は1行の字で流さない**。せっかく解放した
              ものが、報酬やボックスの行と同じ重さで並んでいると気付かれずに流れる。
              報酬を数え終えた後ろから1枚ずつ出す——**同時に出さないこと**（何件解放されたのかが
              形から読めなくなる）。動きは chipPop（モーション低減は index.css の全称ルールが殺す）。 */}
          {outcome.unlocked?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
              {outcome.unlocked.map((a, i) => (
                <div key={a.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", borderRadius: RADIUS.sm,
                  border: `1px solid ${GILT.base}`,
                  background: "linear-gradient(135deg, rgba(232,200,116,0.18), rgba(20,14,8,0.6))",
                  animation: `chipPop 0.42s cubic-bezier(.3,1.6,.5,1) ${1560 + i * 220}ms backwards`,
                }}>
                  <MedalIcon size={17} style={{ color: GILT.bright, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 9, letterSpacing: "0.16em", color: GILT.base }}>実績解放</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: GILT.ivory }}>{a.title}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button type="button" className="kj-pressable" style={goldBtnStyle()} onClick={onRestart}>もう一度</button>
      {onExit && <button type="button" className="kj-pressable" style={outlineBtnStyle()} onClick={onExit}>ホームへ</button>}
    </div>
  );
}

// 対戦中の盤面。state は呼び出し元（通信 or ローカルのCPU進行）が組み立てて渡す。
// 状態機械（shared/match.js）から「自分の視点」を組み立てる。CPU練習と実践
// チュートリアルの両方がこれを通る——**通信版がサーバーから受け取るペイロードと同じ形**に
// 揃えてあるので、MatchBoard側はどちらから来たかを気にしなくてよい。
export function localMatchView(m, me, opp) {
  return {
    round: {
      round: m.round, suddenDeath: m.suddenDeath,
      ante: anteOfRound(m),
      yourLives: m.lives[me], opponentLives: m.lives[opp],
      // **出した1枚も手札として出し続ける。** 状態機械は出した札を hands から抜くが、画面では
      // 抜かずに1枚だけ持ち上げて見せる（HandPicker）——抜くと選んだ瞬間にその札が
      // どこにも無くなり、何を出したのか自分でも分からなくなる。オンライン側は round_start で
      // 受け取った手札を局が終わるまで持ち続けるので、揃えるとこの形になる。
      yourHand: (m.picks[me] ? [...m.hands[me], m.picks[me]] : m.hands[me])
        .map((c) => ({ id: c.id, kind: c.kind, number: c.number })),
      yourBands: m.bands[me], opponentBands: m.bands[opp],
      youChoose: m.chooserId === me,
    },
    kj: m.kjMode ? { mode: m.kjMode, youChose: m.chooserId === me } : null,
    picked: m.picks[me] || null,
    // 相手が出したかどうか（**中身ではなく「出した」という事実だけ**）。卓に伏せ札を置く条件に使う。
    // サーバーは match:card_locked で同じものを配っている。
    opponentPicked: !!m.picks[opp],
    bet: m.phase === PHASE.BETTING || m.phase === PHASE.REVEAL ? {
      pot: potOf(m), yourWager: m.contrib[me], opponentWager: m.contrib[opp],
      yourLives: m.lives[me], opponentLives: m.lives[opp],
      pendingRaise: m.pendingRaise, pendingAmount: m.pendingAmount,
      yourTurn: m.phase === PHASE.BETTING && m.turn === me,
      // オールイン相当まで積み上がると上乗せできない（拠出の上限は少ない方の残りライフ）。
      // サーバー版は match.js が同じ betContext から同じ値を配る。
      // **表示に使う額も betContext から取ること。** ボタンに出る「コール +n」「レイズ +n」は
      // 実際に引かれる額でなければならず、それを知っているのは盤面の拠出と上限だけ。
      canRaise: betContext(m, me).canRaise,
      toCall: betContext(m, me).toCall, room: betContext(m, me).room,
      // この局はベットが1手も成立しない（両者アンティで上限に達している）。
      allIn: m.phase === PHASE.BETTING && bettingExhausted(m),
    } : null,
    phase: m.phase === PHASE.KJ ? "kj" : m.phase === PHASE.CARD ? "card"
      : m.phase === PHASE.BETTING ? "betting" : "reveal",
  };
}

export function MatchBoard({
  selfName, opponentName, totalLives, totalRounds,
  round, kj, picked, opponentPicked, bet, reveal, phase, roundLog = [], notice,
  seconds, timerTotal,
  onChooseKj, onPickCard, onBetAction,
  // 実践チュートリアル専用の指し示し。渡さなければ従来と完全に同じ挙動。
  highlight = null, highlightCardId = null, headerRightExtra = null,
}) {
  // **決着したポットが勝者へ渡るのを見せる**。開示に入った瞬間に
  // ポットを消していた版は、賭けた灯りが誰の手に渡ったのか一度も見えなかった。
  const [payingOut, setPayingOut] = useState(false);
  const roundNo = round?.round ?? 0;
  useEffect(() => {
    if (phase !== "reveal") { setPayingOut(false); return undefined; }
    setPayingOut(true);
    const t = setTimeout(() => setPayingOut(false), POT_PAYOUT_MS);
    return () => clearTimeout(t);
  }, [phase, roundNo]);
  const paying = phase === "reveal" && payingOut && !!reveal;

  // **払い出しの最中はライフを「決着前」の数で出すこと。** ポットはまだ卓の上にあるので、
  // 受け取った後の数を出すと同じライフが手元と中央の両方に数えられる（「決着したら
  // ポットは卓から消す」という以前の規則はこの二重計上を避けるためのもので、**消す代わりに
  // 数字の方を戻せば同じ規則を守れる**）。決着前＝ベット中の残り＝決着後 − 受け取ったポット。
  const myLives = paying
    ? reveal.yourLives - (reveal.youWonPot ? (reveal.pot ?? 0) : 0)
    : (reveal?.yourLives ?? bet?.yourLives ?? round?.yourLives ?? 0);
  const oppLives = paying
    ? reveal.opponentLives - (reveal.youWonPot ? 0 : (reveal.pot ?? 0))
    : (reveal?.opponentLives ?? bet?.opponentLives ?? round?.opponentLives ?? 0);
  // 勝者へ寄せる向き。払い出しの間だけ立てる。
  const potWinner = paying ? (reveal.youWonPot ? "self" : "opp") : null;
  // 開示前は自分の出した札も卓の上では伏せておく（両者とも伏せ札）。
  const myCardValue = reveal ? cardToProps(reveal.yourCard) : null;
  const oppCardValue = reveal ? cardToProps(reveal.opponentCard) : null;
  // **決着したらポットは卓から消すこと。** ライフが動くのは決着の瞬間なので、
  // 開示フェーズでは lives に既に受け取った分が入っている——そこへ賭けた分の灯りも
  // 出したままにすると、同じ灯りが手元と中央の両方に数えられる（実際にそう見えた）。
  // 払い出しが終わってから卓を空にする（それまでは積まれたまま勝者へ滑っている）。
  const settled = phase === "reveal" && !payingOut;
  const myStaked = settled ? 0 : (bet?.yourWager ?? 0);
  const oppStaked = settled ? 0 : (bet?.opponentWager ?? 0);
  // **卓に伏せ札を置いてよいのは、その席が実際に1枚出してからだけ。** 伏せ札は「もう出した」と
  // いう意味を持つので、宣言もカード選択もまだの局面から置いておくと、何も決めていないのに
  // 手が終わっているように見える。ベット以降は定義上両者とも出している。
  const myPlayed = phase === "betting" || phase === "reveal" || !!picked;
  const oppPlayed = phase === "betting" || phase === "reveal" || !!opponentPicked;

  const actionContent =
    phase === "reveal" ? <RoundVerdict reveal={reveal} />
      : phase === "kj" ? (
        // **宣言の前に自分の2枚を見せる。** KING（強い方が勝ち）とJOKER（弱い方が勝ち）の
        // どちらを選ぶかは手札そのものから決まるので、伏せたまま選ばせると宣言が
        // 当てずっぽうになる。隠す理由があるのは相手の札だけで、
        // 自分の札は最初から自分のもの——ここで見せても情報は1ビットも増えない。
        // 宣言しない側にも同じものを出す（次のカード選択を先に考えられる）。
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <HandPeek hand={round?.yourHand} round={round?.round} />
          <KJChoicePanel
            isChooser={!!round?.youChoose}
            onChoose={onChooseKj}
            highlight={highlight}
            // 相手の名前まで入れると390pxで2行に折り返し、手札の横に置いた意味が消える。
            // カード選択フェーズと**同じ一文**にしてあるので、2つの待ち時間が同じものに見える。
            waitingLabel="相手が選んでいる…"
          />
        </div>
      ) : phase === "card" ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          {/* **指示は書かない**。押せる札が出ていること自体が「選べ」であり、
              KING/JOKERのどちらかはヘッダーが常時出している。残すのは自分では分からない
              1つ——相手がまだ選んでいない、という状態だけ。 */}
          <div style={{ fontSize: 11, color: SURFACE.textMuted, minHeight: 14 }}>
            {picked ? "相手が選んでいる…" : ""}
          </div>
          <HandPicker hand={round?.yourHand ?? []} onPick={onPickCard} picked={picked} enabled={!picked}
            width={54} highlightId={highlightCardId} />
        </div>
      ) : (
        <BetActionPanel
          pot={bet?.pot ?? 0} canRaise={bet?.canRaise ?? true}
          yourTurn={!!bet?.yourTurn} pendingRaise={!!bet?.pendingRaise} pendingAmount={bet?.pendingAmount ?? 0}
          toCall={bet?.toCall ?? null} room={bet?.room ?? null} allIn={!!bet?.allIn}
          onAction={onBetAction} opponentName={opponentName} highlight={highlight}
          costFn={lifeRaiseCost}
        />
      );

  // **席の札・灯りの列・公表バッジ・公表履歴は、すべて進捗表(RoundScoreboard)に統合した。**
  // 同じ試合の状態を卓の上・左右の補助列・卓の外の札の3箇所に散らしていたのをやめ、
  // 「名前 / 残ライフ / UP・DOWNのランプ / 各局に出した札」を1枚の表にまとめてある
  // ——PK戦のスコアボードと同じ読み方で、**あと何局あるか**まで同時に読める。
  const scoreboard = (
    <RoundScoreboard
      selfName={selfName} opponentName={opponentName}
      totalRounds={totalRounds} currentRound={round?.round ?? 0} log={roundLog}
    />
  );

  // **必ず height:100% の flex column で包むこと。** BattleScreenChromeはフラグメントを返すので、
  // 包まないと盤面(.kj-battle-field の flex:1)が伸びる先を失い、中身の分の高さしか出ない
  // ——実測で画面下に167px余り、卓がそのぶん小さくなっていた。
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
    <BattleScreenChrome
      hidePanels
      // 進捗表はヘッダーの直下・**盤面の外**に置く。盤面の中に入れると3Dのcanvas(inset:0)と
      // 重なるので、卓が使える縦幅を layoutAnchors 側にも教える必要が出る——外に置けば
      // .kj-battle-layout が flex:1 で残りを取るだけで済み、3D側は何も知らなくてよい。
      scoreboard={scoreboard}
      showTimer={seconds > 0}
      timerSeconds={seconds}
      timerTotal={timerTotal}
      headerLeft={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: FONT.display, letterSpacing: "0.08em", color: GILT.base }}>
            {round?.suddenDeath ? "SUDDEN DEATH" : `ROUND ${round?.round ?? 1} / ${totalRounds ?? "-"}`}
          </span>
          {/* **上がった局だけ出す。** 据え置きの局に出すと、毎局同じ数字が並ぶだけで
              「今回は違う」という一点が埋もれる（この表示の存在理由がそれなので）。 */}
          {round?.ante > BASE_ANTE && (
            <span style={{
              ...numeralStyle(11, GILT.bright, 800), padding: "1px 7px", borderRadius: 3,
              border: `1px solid ${GILT.dim}`, background: "rgba(232,200,116,0.12)",
            }}>アンティ {round.ante}</span>
          )}
        </span>
      }
      headerRight={
        // KING/JOKERの表示は消さずに、必要なら右へ足す（チュートリアルの「やめる」など）。
        // 消してしまうと、いまどちらの払い出しなのかが画面から消える。
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {kj ? (
            <span style={{ fontFamily: FONT.display, color: kj.mode === "king" ? "#4ade80" : "#f87171" }}>
              {kj.mode === "king" ? "KING" : "JOKER"}
            </span>
          ) : phase === "kj" ? (
            // **宣言フェーズだけ、どちらが決める側かを名前で出す**。役の名前は「宣言」。
            // **置き場所はヘッダーの KING/JOKER と同じ枠**——操作ドックは高さが固定で、
            // 行を足すと伸びて3Dの卓へ食い込む（既に踏んだ不具合）。同じ枠に後から
            // KING/JOKER が出るので、1つのものが決まっていく形にも読める。
            <span style={{ fontSize: 11, color: SURFACE.textMuted }}>
              宣言 <span style={{
                fontFamily: FONT.display,
                color: round?.youChoose ? GILT.bright : SURFACE.textMuted,
              }}>{round?.youChoose ? "あなた" : "相手"}</span>
            </span>
          ) : null}
          {headerRightExtra}
        </span>
      }
      // 灯り（ライフ）と賭けた数はそのまま3Dシーンへ渡す。**差分から導出させないこと**——
      // 旧実装はチップの移動量を持ち点の増減から逆算していて、観測を1回でも落とすとずれ続けた。
      self={{
        name: selfName, lives: myLives, totalLives, staked: myStaked,
        cardValue: myCardValue, cardPlaced: myPlayed, cardPending: phase === "betting",
      }}
      opponent={{
        name: opponentName, lives: oppLives, totalLives, staked: oppStaked,
        cardValue: oppCardValue, cardPlaced: oppPlayed, cardPending: phase === "betting",
      }}
      kjMode={kj?.mode}
      potWinner={potWinner}
      // 配札の演出（カードシュー）のキー。**局番号にすること**——局が変われば必ず両者に
      // 1枚ずつ補充されるので、カードの中身を見て変化を探す必要がない。
      dealKey={round?.round ?? null}
      actionContent={actionContent}
      // 卓の上に重ねるDOMはここで差し込む。座標は3D側が投影した実座標。
      // 卓に重ねるDOM。**フェルトの上には何も置かない**——席の現況は卓の縁の外
      // （相手は上・自分は下）に浮かべる。名前を書かなくてもどちらのものか分かるのは、
      // 場札の並び（相手が奥・自分が手前）とまったく同じ上下関係だから。
      overlay={(L) => (
        <>
          <SeatPanel at={L.oppPanel} lives={oppLives} staked={oppStaked}
            bands={round?.opponentBands} tone="opp" />
          <SeatPanel at={L.selfPanel} lives={myLives} staked={myStaked}
            bands={round?.yourBands} tone="self" />
          {notice && (
            <div style={{
              position: "absolute", left: "50%", top: 8, transform: "translateX(-50%)",
              padding: "4px 12px", borderRadius: RADIUS.sm, background: "rgba(20,4,4,0.9)",
              border: `1px solid ${PENALTY_RED}`, color: PENALTY_RED, fontSize: 11,
            }}>{notice}</div>
          )}
        </>
      )}
    />
    </div>
  );
}

// 卓の外に浮かべる席の現況（残りライフ＋UP/DOWN）。3Dが投影した座標に絶対配置するだけで、
// 中身は SeatStatus が持つ。**pointerEventsを切ること**——卓の上に重なる位置なので、
// 拾ってしまうと下のcanvasやドックへのクリックを食う。
function SeatPanel({ at, ...rest }) {
  if (!at) return null;
  return (
    <div style={{
      position: "absolute", left: at.x, top: at.y, transform: "translate(-50%,-50%)",
      pointerEvents: "none",
    }}>
      <SeatStatus {...rest} />
    </div>
  );
}

// 宣言フェーズに出す手札の覗き見。**押せない**（選ぶのは宣言が決まってから）。
// 操作ドック(.kj-action-dock)は固定高さなので、KING/JOKERのボタンとは縦に積まず横に並べる
// ——積んだ時点でドックが伸び、その上に敷いてある3Dの卓へ食い込む（index.cssの注記参照）。
//
// **配られた札は、カードシューから滑ってくる札が届いてから並べる。** 状態機械は局の頭で
// 既に手札を2枚にしているので、素直に描くと**機械から出てくる前から手札が揃っている**
// 。届く時刻は three/dealTiming.js が3D側と共有していて、ここでは
// animation-delay として渡すだけ——タイマーもstateも持たない。
// 持ち越した札には何も付けない。あれは配られた札ではなく、元から持っていた札。
function HandPeek({ hand, round }) {
  if (!hand?.length) return null;
  const dealt = Math.min(hand.length, dealtPerSide(round ?? 1));
  const firstDealt = hand.length - dealt;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {/* **札の大きさはカード選択フェーズ(HandPicker)と揃えること。** 見る場面と選ぶ場面で
            大きさが変わると同じ物に見えず、しかも Queen は小さくすると金の塊にしか見えない
            ——宣言の前に見せる意味がいちばん大きいのがその1枚。 */}
        {hand.map((c, i) => (
          <div key={c.id}
            className={i >= firstDealt ? "kj-card-arrive" : undefined}
            style={i >= firstDealt ? { animationDelay: `${selfCardLandsAt(i - firstDealt)}ms` } : undefined}>
            <PlayingCard {...cardToProps(c)} width={54} />
          </div>
        ))}
      </div>
    </div>
  );
}

