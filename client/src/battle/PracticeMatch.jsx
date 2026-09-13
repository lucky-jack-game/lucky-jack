// CPU練習。**進行は shared/match.js をそのまま回す**ので、オンライン対戦
// (server/match.js) と1手も違わない。旧実装がサーバーと画面に
// 同じルールを2つ持って食い違わせていた失敗を、最初から避けるための構成。
//
// ここが持つのは「CPUがいつ動くか」だけ。**CPUの思考時間を行動の種類と相関させないこと**——
// 相関させた瞬間、待ち時間そのものが手の強さを漏らすテルになり、読み合いが時計を見る遊びになる。
import { useCallback, useEffect, useRef, useState } from "react";
import { MODES } from "../../../shared/engine.js";
import {
  PHASE, createMatch, beginRound, declareKJ, pickCard, autoPickCard,
  bothPicked, beginBetting, betAction, bettingExhausted, resolveRound,
  cpuBetDecision, cpuKJDecision,
} from "../../../shared/match.js";
// **進行の「間」の尺はサーバーと同じ場所から読む**（shared/pacing.js のコメント参照）。
import { NEXT_ROUND_DELAY_MS, ALL_IN_HOLD_MS } from "../../../shared/pacing.js";
import { MatchLobbyView, MatchEndView, MatchBoard, localMatchView } from "./MatchView.jsx";
import { createStats, recordRound, finishMatch } from "./matchStats.js";
import { useRoundLog } from "./roundLog.js";
import { getProfileName } from "./profile.js";

const YOU = "you", CPU = "cpu";
const CPU_NAME = "CPU";
// CPUの間。行動の種類とは無関係な範囲でばらつかせる。
const think = () => 380 + Math.random() * 440;

// autoStart: 開始前の画面（MatchLobbyView）を挟まずに始める。ロビーの PLAY から来たとき——
// PLAY を押した人にもう一度「CPUと対戦する」を押させない。
export default function PracticeMatch({ mode = "casual", onExit, onWalletChange, autoStart = false }) {
  const modeDef = MODES[mode] || MODES.casual;
  const mRef = useRef(null);
  const timersRef = useRef([]);
  const [started, setStarted] = useState(false);
  const [view, setView] = useState(null);   // 描画用に切り出した状態
  const [ending, setEnding] = useState(null);
  const [outcome, setOutcome] = useState(null); // 報酬・実績・ボックス（終了画面用）
  const statsRef = useRef(null);
  // 進捗表(RoundScoreboard)が読む「これまでの局」。3画面で同じ作り方をする（roundLog.js）。
  const { log: roundLog, pushRound, resetLog } = useRoundLog();

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
  const later = useCallback((fn, ms) => { timersRef.current.push(setTimeout(fn, ms)); }, []);
  useEffect(() => clearTimers, []);

  // 自分の視点の組み立ては localMatchView に集約してある（実践チュートリアルも同じものを通る）。
  const sync = useCallback((extra = {}) => {
    const m = mRef.current; if (!m) return;
    setView({ ...localMatchView(m, YOU, CPU), ...extra });
  }, []);

  const start = useCallback(() => {
    clearTimers();
    mRef.current = createMatch({ ids: [YOU, CPU], lives: modeDef.lives, rounds: modeDef.rounds });
    statsRef.current = createStats(modeDef.lives);
    setEnding(null); setOutcome(null); resetLog(); setStarted(true);
    openRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeDef.lives, modeDef.rounds]);

  // **effect の中で直接 start() しないこと。** StrictMode の二重実行では、1回目の後始末
  // （上の clearTimers）がCPUの手番タイマーを消してしまい、ref で1回に固定していると2回目は
  // 始まらない＝CPUが永久に動かない試合になる。タイマーで1拍遅らせれば、1回目は後始末で
  // 取り消され、2回目だけが走る。
  useEffect(() => {
    if (!autoStart) return undefined;
    const t = setTimeout(start, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openRound = useCallback(() => {
    const m = mRef.current;
    if (!beginRound(m)) return finish();
    sync({ reveal: null });
    if (m.chooserId === CPU) later(() => applyKJ(cpuKJDecision(m)), think());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, later]);

  const applyKJ = useCallback((choice) => {
    const m = mRef.current;
    if (!declareKJ(m, choice)) return;
    sync({ reveal: null });
    // CPUの札選びは人間の選択を待たずに済ませる（同時選択なので順序は結果に影響しない）。
    later(() => { autoPickCard(m, CPU); if (bothPicked(m)) openBetting(); else sync(); }, think());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, later]);

  const openBetting = useCallback(() => {
    const m = mRef.current;
    beginBetting(m);
    sync();
    step();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  // 手番がCPUなら間を置いて打たせ、人間ならそのまま待つ。
  const step = useCallback(() => {
    const m = mRef.current;
    if (m.phase !== PHASE.BETTING) return;
    // 積む余地が無い局。**同じtickで畳まないこと**——カードを選んだ瞬間に決着したように
    // しか見えない（実測で試合の28.6%がこの局で終わる）。一拍置いてポットを見せてから開示へ。
    if (bettingExhausted(m)) return later(settle, ALL_IN_HOLD_MS);
    if (m.turn === CPU) {
      later(() => {
        const { action, fraction } = cpuBetDecision(m, CPU);
        const done = betAction(m, CPU, action, fraction);
        sync();
        if (done) settle(); else step();
      }, think());
    }
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
    // 集計はオンライン対戦と同じ関数を通す（数え方を2箇所に書かない）。
    recordRound(statsRef.current, reveal);
    pushRound(reveal);
    setView((v) => ({ ...v, phase: "reveal", reveal }));
    // **決着と同じtickで次の局を始めないこと**（オンライン側と同じ理由）。
    later(() => (m.ended ? finish() : openRound()), NEXT_ROUND_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [later, pushRound]);

  const finish = useCallback(() => {
    const m = mRef.current;
    // **確定処理を二度走らせないこと。** finish()は「ラウンド上限で局が開けなかった時」と
    // 「決着の3秒後にm.endedを見た時」の2経路から呼ばれる。今は排他だが、片方だけ増やした
    // 瞬間に履歴・CHIP・ボックスが二重に付く（オンライン側も同じ理由でrefを畳んでいる）。
    if (!statsRef.current) return;
    const stats = statsRef.current;
    statsRef.current = null;
    const e = m.ended || { reason: "roundLimit", winnerId: null };
    const end = {
      reason: e.reason, youWon: e.winnerId === YOU, draw: e.winnerId === null,
      yourLives: Math.max(0, m.lives[YOU]), opponentLives: Math.max(0, m.lives[CPU]),
      roundsPlayed: m.roundsPlayed, opponentName: CPU_NAME,
    };
    // **online:false を渡すこと。** 段位はオンラインのランクマッチだけで動く。
    setOutcome(finishMatch({ stats, ending: end, mode, online: false }));
    // 報酬が確定した瞬間にヘッダーの残高を更新する（「もう一度」で続ける間は画面を離れない）。
    onWalletChange?.();
    setEnding(end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const onChooseKj = useCallback((choice) => applyKJ(choice), [applyKJ]);
  const onPickCard = useCallback((card) => {
    const m = mRef.current;
    if (!pickCard(m, YOU, card.id)) return;
    sync();
    if (bothPicked(m)) openBetting();
  }, [sync, openBetting]);
  const onBetAction = useCallback((action, fraction) => {
    const m = mRef.current;
    if (m.turn !== YOU) return;
    const done = betAction(m, YOU, action, fraction);
    sync();
    if (done) settle(); else step();
  }, [sync, settle, step]);

  if (ending) {
    return <MatchEndView ending={ending} totalLives={modeDef.lives} outcome={outcome}
      onRestart={start} onExit={onExit} />;
  }
  if (!started || !view) {
    // 自動で始める場合は、始まるまでの1拍に開始前の画面を一瞬だけ映さない
    return autoStart ? null : <MatchLobbyView isPractice mode={mode} onStart={start} onExit={onExit} />;
  }
  return (
    <MatchBoard
      selfName={getProfileName()} opponentName={CPU_NAME}
      totalLives={modeDef.lives} totalRounds={modeDef.rounds}
      {...view} roundLog={roundLog}
      seconds={0} timerTotal={0}
      onChooseKj={onChooseKj} onPickCard={onPickCard} onBetAction={onBetAction}
    />
  );
}
