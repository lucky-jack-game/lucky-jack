// 実践チュートリアル。**本物の対戦画面(MatchBoard)で、本物の状態機械
// (shared/match.js)を回す**——練習用の簡易画面を別に作ると、そこで覚えた操作が
// 本番に転移しない。ルールは1行も持たない（ここに判定を書いた瞬間に本番と割れる）。
//
// ── 台本にできるのは「配られる札」と「CPUの決断」だけ ──
// 状態機械は `shoe`（配られる順に並べたカードの列）を引数で受け取れるので、**乱数に頼らず
// 局面を固定できる**。CPUの宣言・ベットも、`cpuKJDecision`/`cpuBetDecision` の代わりに
// 台本の値を `declareKJ`/`betAction` へ渡すだけ——どちらも決断の差し替えであって、
// ルールの差し替えではない。
//
// ── 教える順序 ──
// Ⅰの逆転 → JOKER → Queen → フォールド。**KING/JOKERの反転がこのゲームで一番つまずく所**
// なので、2局目で必ず「カードで負けたのにライフを取る」を体験させる。
//
// ── 選択を強制しない ──
// 推奨は言うが、外した選択も打てる。**「なぜその選択が正しいのか」は、説明されるより
// 一度負けた方が早い**。台本の札はどの分岐に転んでも次の局が成立するよう組んである
// （相手は毎局Ⅹ2枚なので、こちらが何を残しても局面の意味が変わらない）。
import { useCallback, useEffect, useRef, useState } from "react";
import { makeNumberCard, makeQueenCard, ANTE as BASE_ANTE } from "../../../shared/engine.js";
import {
  PHASE, createMatch, beginRound, declareKJ, pickCard, autoPickCard,
  bothPicked, beginBetting, betAction, bettingExhausted, resolveRound,
} from "../../../shared/match.js";
import { ALL_IN_HOLD_MS } from "../../../shared/pacing.js";
import { MatchBoard, localMatchView } from "./MatchView.jsx";
import { useRoundLog } from "./roundLog.js";
import { GILT, SURFACE, RADIUS, FONT, numeralStyle, goldBtnStyle, GoldFoilText } from "../shared.jsx";

const YOU = "you", CPU = "cpu";
const CPU_NAME = "コーチ";
const LIVES = 8;
const think = () => 420 + Math.random() * 320;

// ─── 配られる札（台本） ───
// 配り順は状態機械が決めている: 最初に [あなた×2, 相手×2]、以降は決着ごとに [あなた, 相手]。
// **相手には毎局Ⅹを2枚持たせる**ので、相手がどちらを出しても結果が変わらない
// ——CPUの選択に乱数が残っていても、教えたい局面が壊れない。
const Q = "queen";
const SCRIPT_SHOE = [
  9, 1,     // 1局目 あなた: Ⅸ(UP) と Ⅰ(DOWN)
  10, 10,   // 1局目 相手: Ⅹ Ⅹ
  2, 10,    // 1局目の後の補充
  Q, 10,    // 2局目の後の補充（Queenが来る）
  3, 10,    // 3局目の後の補充
];

// ─── 台本 ───
// **文言は「見出し(数語) + 一行」に固定する。** 散文で書くと、覚えるべき一点が文の中に埋もれる。
// `line`はそのままAIナレーションの原稿になるので、1ビート＝1発話。読点で繋いで2文にしない。
// `id`は音声ファイルの対応キーを兼ねるため、意味のある不変の文字列にする（並び替えても
// 壊れないよう連番にしない）。
// `focus`は**本物のボタンを光らせる**キー（KJChoicePanel/BetActionPanel/HandPickerの
// `highlight`へそのまま渡る）。説明用の偽ボタンを別に描かないこと。
const STAGES = [
  {
    id: "one-eats-ten",
    chooser: YOU,
    // 宣言の前だけ2ビート出す: 1枚目は読むだけ（「次へ」で進む）、**押せるのは2枚目の番**。
    // **focus は押せる番のビート（kj2）に付けること。** 1枚目に付けていた版は、1枚目の間は
    // まだ押せないので光らず、押せるようになった2枚目には指定が無いので、**最初の宣言で
    // ボタンが一度も光らなかった**（1局目・3局目とも。2026-09-13 に発見）。
    // 文言は**光っているボタンと同じ話をする**——話題がずれると、読み手はどちらに従えばいいか分からない。
    kj: { id: "one-kj", title: "相手は UP が2枚", line: "相手の手札は VI〜X の強い札だけ。" },
    kj2: { id: "one-kj2", title: "KING を宣言", line: "札で勝った方がライフを取る。", focus: "king" },
    card: { id: "one-card", title: "I を出す", line: "I だけは X に勝てる。", pick: { number: 1 } },
    // ボタンの名前（チェック／コール）は書かない。相手の出方で同じ場所の名前が入れ替わる。
    bet: { id: "one-bet", title: "賭ける", line: "勝てる局は、降りずに乗る。", focus: "callCheck" },
    reveal: { id: "one-rev", title: "I が X に勝った", line: "強い札を持つ相手にも、I なら勝てる。" },
  },
  {
    id: "joker",
    chooser: YOU,
    kj: { id: "joker-kj", title: "JOKER を宣言", line: "どちらの札も負けそうな時は、負けた方が取る JOKER。", focus: "joker" },
    card: { id: "joker-card", title: "弱い 2 を出す", line: "強い IX は次の局のために残す。", pick: { number: 2 } },
    bet: { id: "joker-bet", title: "賭ける", line: "負ける札を出した今は、降りずに乗る。", focus: "callCheck" },
    reveal: { id: "joker-rev", title: "札で負けて、ライフを取った", line: "JOKER では、負けた方がライフを取る。" },
  },
  {
    id: "queen",
    chooser: YOU,
    kj: { id: "queen-kj", title: "Queen が来た", line: "相手には、弱い札と同じ DOWN に見えている。" },
    kj2: { id: "queen-kj2", title: "KING を宣言", line: "Queen は I 以外のすべてに勝つ。", focus: "king" },
    card: { id: "queen-card", title: "Queen を出す", line: "相手の X にも勝てる。", pick: { kind: "queen" } },
    bet: { id: "queen-bet", title: "大きく賭ける", line: "勝ちが決まった局は、レイズで上乗せする。", focus: "raisePot" },
    reveal: { id: "queen-rev", title: "Queen で勝った", line: "Queen は1試合に1枚しか無い。" },
  },
  {
    id: "fold",
    chooser: CPU,
    cpuKj: "king",
    cpuBets: [{ action: "raise", fraction: 1 }],
    kj: { id: "fold-kj", title: "宣言は相手", line: "前の局でライフを失った側が宣言する。" },
    card: { id: "fold-card", title: "勝ち目は薄い", line: "相手は KING で UP が2枚、こちらの札では分が悪い。" },
    // この局は先に賭けるのがこちらで、まだ誰も上げていない＝ボタンは必ずチェックなので名前を書いてよい。
    bet: { id: "fold-bet", title: "様子を見る", line: "チェックで、賭けを増やさずに回す。", focus: "callCheck" },
    bet2: { id: "fold-bet2", title: "降りる", line: "相手が上げてきた今、降りれば出した分だけで済む。", focus: "fold" },
    reveal: { id: "fold-rev", title: "降りて正解", line: "乗っていたら、もっと失っていた。" },
  },
];

function buildShoe() {
  return SCRIPT_SHOE.map((v) => (v === Q ? makeQueenCard() : makeNumberCard(v)));
}

// 台本の指定（{number} か {kind:"queen"}）を、いま手札にある実カードのidへ解決する。
function resolvePick(hand, spec) {
  if (!spec || !hand) return null;
  const hit = hand.find((c) => (spec.kind ? c.kind === spec.kind : c.number === spec.number));
  return hit ? hit.id : null;
}

// コーチの吹き出し。**見出し＋一行＋（必要なら）次へ**だけを置く。
//
// 置き場所は**操作ドックのすぐ上**。上から順に「進捗表 → 相手の現況 → 卓 → 自分の現況 →
// コーチ → ボタン」となり、読む順序と操作する順序が一致する。
//
// **上に置いてはいけない。** 画面の上半分には、台本が言及する物が2つ並んでいる——
// 進捗表（打った結果が1局ずつ積まれる）と相手の現況（1局目の台詞がまさに「相手は UP が2枚」）。
// どちらも吹き出しで隠すと、教えている当人が対象を見られなくなる（両方とも一度そうなった）。
// 隠してよいのは自分の現況だけで、それは手札そのものがドックに出ているので二重にある。
// **値は操作ドックの高さ（モバイル124px / PC112px）より大きく取ること。**
const COACH_BOTTOM_PX = 134;

function Coach({ beat, onNext, nextLabel, step, total }) {
  if (!beat) return null;
  return (
    <div style={{
      position: "absolute", bottom: COACH_BOTTOM_PX, left: 0, right: 0, zIndex: 20,
      display: "flex", justifyContent: "center", pointerEvents: "none", padding: "0 12px",
    }}>
      <div style={{
        pointerEvents: "auto", maxWidth: 400, width: "100%",
        background: "rgba(10,8,6,0.96)", border: `1px solid ${GILT.dim}`,
        borderRadius: RADIUS.md, padding: "10px 14px",
        boxShadow: "0 8px 28px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
          <span style={{ ...numeralStyle(9, GILT.dim, 700), letterSpacing: "0.12em" }}>{step}/{total}</span>
          <span style={{ fontFamily: FONT.display, fontSize: 14, color: GILT.bright, fontWeight: 700 }}>{beat.title}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "#e6dcc8", lineHeight: 1.65 }}>{beat.line}</div>
        {onNext && (
          <button onClick={onNext} className="kj-pressable" style={{
            ...goldBtnStyle(), width: "100%", padding: "8px 0", marginTop: 9, fontSize: 13,
          }}>{nextLabel || "次へ"}</button>
        )}
      </div>
    </div>
  );
}

export default function PracticeTutorial({ onEnd, profile }) {
  const mRef = useRef(null);
  const timersRef = useRef([]);
  const cpuBetsRef = useRef([]);      // その局で残っている台本のCPU手
  const [stageIndex, setStageIndex] = useState(0);
  const [view, setView] = useState(null);
  const [kjBeatSeen, setKjBeatSeen] = useState(false);   // 宣言前の2枚目のビート用
  // 進捗表(RoundScoreboard)は本番と同じものが出る。台本で局面を固定しているので、
  // **教えた通りの並びがそのまま表に残る**——「Ⅰ が Ⅹ を食った」局が金枠で残るのが確認になる。
  const { log: roundLog, pushRound } = useRoundLog();
  const [done, setDone] = useState(false);

  const total = STAGES.length;
  const stage = STAGES[Math.min(stageIndex, total - 1)];

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
  const later = useCallback((fn, ms) => { timersRef.current.push(setTimeout(fn, ms)); }, []);
  useEffect(() => clearTimers, []);

  const sync = useCallback((extra = {}) => {
    const m = mRef.current; if (!m) return;
    setView({ ...localMatchView(m, YOU, CPU), ...extra });
  }, []);

  // ─── 局の開始 ───
  const openRound = useCallback((index) => {
    const m = mRef.current;
    const st = STAGES[index];
    if (!st) { setDone(true); return; }
    // **毎局ライフを戻す。** 1局ずつが独立した練習問題なので、勝ち負けを持ち越す意味が無い。
    // それ以上に、持ち越すと最後の「降りる」局が壊れる: 拠出の上限は少ない方の残りライフ
    // (`effectiveStack`)なので、相手を削り切る手前まで勝ち進むと**相手が大きく張れなくなり、
    // 降りる価値のある局面が作れない**（実測で相手が残り1ライフになり、教えたい大きなレイズが
    // 1に丸められた）。相手を倒し切ってしまえば試合ごと終わり、残りの局は出てこない。
    m.lives = { [YOU]: LIVES, [CPU]: LIVES };
    m.ended = null;
    if (!beginRound(m)) { setDone(true); return; }
    // **宣言権は台本で決める。** 状態機械は「前の局でポットを失った側」へ回すので、
    // こちらが勝ち続けると相手が宣言側に固定され、教えたい宣言が打てなくなる。
    m.chooserId = st.chooser;
    cpuBetsRef.current = [...(st.cpuBets || [])];
    setKjBeatSeen(false);
    sync({ reveal: null });
    if (st.chooser === CPU) later(() => applyKJ(st.cpuKj || "king"), think());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, later]);

  const applyKJ = useCallback((choice) => {
    const m = mRef.current;
    if (!declareKJ(m, choice)) return;
    sync({ reveal: null });
    later(() => { autoPickCard(m, CPU); if (bothPicked(m)) openBetting(); else sync(); }, think());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, later]);

  const openBetting = useCallback(() => {
    beginBetting(mRef.current);
    sync();
    step();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  // 手番がCPUなら台本の一手を打たせる（尽きたらチェック／コールで素直に回す）。
  const step = useCallback(() => {
    const m = mRef.current;
    if (m.phase !== PHASE.BETTING) return;
    // 台本は毎局ライフを戻すのでここは通らないはずだが、**本番と同じ形にしておく**
    // （PracticeMatch.jsx / server/match.js と同じ一拍）。
    if (bettingExhausted(m)) return later(settle, ALL_IN_HOLD_MS);
    if (m.turn !== CPU) return;
    later(() => {
      const scripted = cpuBetsRef.current.shift();
      const a = scripted || { action: "call" };
      const finished = betAction(m, CPU, a.action, a.fraction);
      sync();
      if (finished) settle(); else step();
    }, think());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, later]);

  const settle = useCallback(() => {
    const m = mRef.current;
    const r = resolveRound(m);
    const reveal = {
      yourCard: r.cards[YOU], opponentCard: r.cards[CPU], kjMode: r.kjMode,
      youWonCard: r.cardWinnerId === YOU, youWonPot: r.potWinnerId === YOU,
      folded: !!r.folded, youFolded: r.folded === YOU,
      pot: r.pot, livesMoved: r.moved,
      yourLives: r.lives[YOU], opponentLives: r.lives[CPU],
    };
    pushRound(reveal);
    setView((v) => ({ ...v, phase: "reveal", reveal }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushRound]);

  // ─── 開始 ───
  useEffect(() => {
    mRef.current = createMatch({
      ids: [YOU, CPU], lives: LIVES, rounds: STAGES.length, shoe: buildShoe(),
      // **台本のアンティは据え置き。** 本番は最終局だけアンティが上がるが、この4局は
      // 毎局ライフを戻す独立した練習台で「最終局」に相当する局が無い。既定のまま作ると
      // 4局目だけ額が変わり、教えたい「降りる」局の数字が台本と食い違う。
      anteTail: [BASE_ANTE],
    });
    openRound(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextStage = () => {
    const next = stageIndex + 1;
    if (next >= total) { setDone(true); return; }
    setStageIndex(next);
    openRound(next);
  };

  const onChooseKj = (choice) => applyKJ(choice);
  const onPickCard = (card) => {
    const m = mRef.current;
    if (!pickCard(m, YOU, card.id)) return;
    sync();
    if (bothPicked(m)) openBetting();
  };
  const onBetAction = (action, fraction) => {
    const m = mRef.current;
    if (m.turn !== YOU) return;
    const finished = betAction(m, YOU, action, fraction);
    sync();
    if (finished) settle(); else step();
  };

  if (done) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, gap: 16 }}>
        <GoldFoilText size={26}>READY</GoldFoilText>
        <div style={{ fontSize: 13, color: "#cfc3ae", lineHeight: 1.9, textAlign: "center", maxWidth: 340 }}>
          宣言して、札を出して、賭ける。<br />勝てない局は降りる。
        </div>
        <button onClick={onEnd} className="kj-pressable" style={{ ...goldBtnStyle(), padding: "13px 40px" }}>ホームへ</button>
      </div>
    );
  }
  if (!view) return null;

  // ── いま出すビートと、光らせる場所 ──
  // 光らせるのは「今その操作を選べる時」だけ（結果表示中に光っていても指し示す先が無い）。
  const yourTurn = !!view.bet?.yourTurn;
  const beat = view.phase === "kj"
    ? (stage.kj2 && !kjBeatSeen ? stage.kj : (stage.kj2 || stage.kj))
    : view.phase === "card" ? (view.picked ? null : stage.card)
      : view.phase === "betting" ? (yourTurn ? (view.bet?.pendingRaise && stage.bet2 ? stage.bet2 : stage.bet) : null)
        : stage.reveal;
  const canAct = view.phase === "kj" ? view.round?.youChoose && (!stage.kj2 || kjBeatSeen)
    : view.phase === "card" ? !view.picked
      : view.phase === "betting" ? yourTurn : false;

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <MatchBoard
        selfName={profile?.name || "あなた"} opponentName={CPU_NAME}
        totalLives={LIVES} totalRounds={total}
        {...view}
        roundLog={roundLog}
        seconds={0} timerTotal={0}
        highlight={canAct ? beat?.focus ?? null : null}
        highlightCardId={view.phase === "card" && !view.picked ? resolvePick(view.round?.yourHand, stage.card?.pick) : null}
        headerRightExtra={
          <button onClick={onEnd} className="kj-pressable" style={{
            background: "transparent", border: "none", color: SURFACE.textMuted, fontSize: 11, cursor: "pointer",
          }}>やめる</button>
        }
        onChooseKj={onChooseKj} onPickCard={onPickCard} onBetAction={onBetAction}
      />
      <Coach
        beat={beat} step={stageIndex + 1} total={total}
        // 宣言の前だけ2枚のビートを続けて出す（「手札は2枚」→「相手はUPが2枚」）。
        onNext={view.phase === "kj" && stage.kj2 && !kjBeatSeen ? () => setKjBeatSeen(true)
          : view.phase === "reveal" ? nextStage : null}
        nextLabel={view.phase === "reveal" ? (stageIndex + 1 >= total ? "終える" : "次の局へ") : "次へ"}
      />
    </div>
  );
}
