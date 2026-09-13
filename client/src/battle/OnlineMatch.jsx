// 1対1の対戦のオンライン対戦画面。サーバー(server/match.js)が権威で、ここは表示と入力だけ。
// 進行の実体は shared/match.js（サーバーが回す）、見た目は MatchView.jsx（CPU練習と共有）。
//
// **提出版では入口を閉じている**（features.js の ONLINE_ENABLED）。オンラインを戻すときのためにコードは残してある。
//
// ── stale closure に注意 ──
// Socket.ioのハンドラは useEffect(..., []) で1度だけ登録されるので、その中でstateを直接読むと
// マウント時点の値に固定された古い値を掴む（このリポジトリで何度も踏んでいる）。
// ここでは**ハンドラは受け取ったpayloadをそのままstateへ流すだけ**にして、
// 「前の値を見て決める」処理は必ず setState の更新関数の中で行う。
import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../net/socket.js";
import { MODES } from "../../../shared/engine.js";
import { MatchLobbyView, MatchEndView, MatchBoard } from "./MatchView.jsx";
import { createStats, recordRound, finishMatch } from "./matchStats.js";
import { useRoundLog } from "./roundLog.js";
import { getProfileName } from "./profile.js";

export default function OnlineMatch({ mode: initialMode = "casual", onExit, onLiveChange, onWalletChange }) {
  // モードはこの画面の中で選ぶ（ホームの扉を増やさないため。MatchViewのModeToggle参照）。
  const [mode, setMode] = useState(initialMode);
  const [phase, setPhase] = useState("idle");   // idle|queued|kj|card|betting|reveal|end
  const [info, setInfo] = useState(null);
  const [round, setRound] = useState(null);
  const [kj, setKj] = useState(null);
  const [picked, setPicked] = useState(null);
  // 相手が札を出したか。**中身ではなく「出した」という事実だけ**（サーバーが match:card_locked で
  // 配る）。卓に伏せ札を置く条件に使う——出していない席に伏せ札を置くと、まだ何も決めていないのに
  // 手が終わっているように見える。
  const [opponentPicked, setOpponentPicked] = useState(false);
  const [bet, setBet] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [ending, setEnding] = useState(null);
  const [notice, setNotice] = useState(null);
  // 進捗表(RoundScoreboard)が読む「これまでの局」。3画面で同じ作り方をする（roundLog.js）。
  const { log: roundLog, pushRound, resetLog } = useRoundLog();
  const [clock, setClock] = useState(null);
  const [seconds, setSeconds] = useState(0);

  // **いまどの段階に居るかをrefでも持つ。** アンマウント時の後片付けは
  // useEffect(..., []) のクリーンアップから読むので、stateを直接見ると
  // マウント時点の "idle" に固定された古い値を掴む（このリポジトリで何度も踏んでいる）。
  // **onWalletChange はrefミラー越しに呼ぶこと。** ハンドラは useEffect(..., []) で1度だけ
  // 張るので、propを直接掴むとマウント時点の関数に固定される（親が作り直すと古い方を呼ぶ）。
  const walletRef = useRef(onWalletChange);
  useEffect(() => { walletRef.current = onWalletChange; }, [onWalletChange]);

  const phaseRef = useRef("idle");
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // **進行中かどうかを親へ渡す。** 対戦中にナビを押すと投了になるので、親はここを見て
  // 確認を出す。キュー待ち(queued)と結果(end)は失う物が無いので進行中に数えない。
  const live = phase !== "idle" && phase !== "queued" && phase !== "end";
  useEffect(() => {
    onLiveChange?.(live);
    return () => onLiveChange?.(false);
  }, [live, onLiveChange]);

  const pickedRef = useRef(null);
  // **集計はrefで持つこと。** Socket.ioのハンドラは useEffect(..., []) で1度だけ登録されるので、
  // その中からstateを読むとマウント時点の値に固定された古い値を掴む（このリポジトリで何度も踏んでいる）。
  const statsRef = useRef(null);
  const modeRef = useRef(initialMode);
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    const on = {
      "match:queued": () => setPhase("queued"),
      "match:found": (p) => {
        setInfo(p); resetLog(); setEnding(null); setOutcome(null); setNotice(null);
        statsRef.current = createStats(p.lives ?? 0);
      },
      "match:round_start": (p) => {
        setRound(p); setKj(null); setPicked(null); setReveal(null); setBet(null);
        setOpponentPicked(false);
        pickedRef.current = null;
        setPhase("kj");
      },
      "match:kj_result": (p) => { setKj(p); setPhase("card"); },
      "match:bet_update": (p) => { setBet(p); setPhase((cur) => (cur === "reveal" || cur === "end" ? cur : "betting")); },
      // 公表の**遷移**が読みの本体（UP-DOWNだった相手が次にDOWN-DOWNなら出したのはUP側）。
      // 進捗表は実際に出た札そのものを並べるので、遷移から逆算する手間ごと要らなくなる。
      "match:reveal": (p) => { recordRound(statsRef.current, p); pushRound(p); setReveal(p); setPhase("reveal"); setClock(null); },
      "match:end": (p) => {
        // 報酬・実績・段位の確定はここ1回だけ（matchStats.jsが唯一の書き込み口）。
        if (statsRef.current) {
          setOutcome(finishMatch({ stats: statsRef.current, ending: p, mode: modeRef.current, online: true }));
          statsRef.current = null; // 再入で二重に加算しないよう必ず畳む
          // 報酬が確定した瞬間にヘッダーの残高を更新する（この画面に留まったままでも合うように）。
          walletRef.current?.();
        }
        setEnding(p); setPhase("end"); setClock(null);
      },
      "match:opponent_left": (p) => setNotice(`${p.opponentName} が退出しました`),
      "match:kj_deadline": setClock,
      "match:card_deadline": setClock,
      "match:turn_deadline": setClock,
      "match:card_locked": (p) => setOpponentPicked(!!p.opponentLocked),
    };
    for (const [ev, fn] of Object.entries(on)) socket.on(ev, fn);
    return () => {
      for (const [ev, fn] of Object.entries(on)) socket.off(ev, fn);
      // **画面を離れるときは必ずサーバーへ伝えること。** この画面は下部ナビの「ホーム」等で
      // いつでもアンマウントされるが、ソケットはアプリ全体で1つを共有しているので繋がったまま
      // ——disconnectが起きないため、黙って抜けると次の2つが起きる（どちらも再現済み）:
      //   ・キュー待ちのまま抜けた人が、次に来た人と成立してしまう（相手は幽霊と対戦する）
      //   ・対戦中に抜けた人がもう一度キューに入ると、新旧2つの試合に同時に属し、
      //     古い試合の match:end が、いま遊んでいる試合の最中に届く
      const p = phaseRef.current;
      if (p === "queued") socket.emit("match:cancel");
      else if (p !== "idle" && p !== "end") socket.emit("match:leave");
    };
    // **登録は1度だけ。** pushRound/resetLog は useRoundLog が useCallback([]) で返す
    // 不変の関数なので依存に足しても値は変わらないが、依存配列に並べた瞬間「ここは張り直しうる」
    // という誤った読み方を招く——このファイルはハンドラを**1度だけ**張る前提で書いてある
    // （stale closureを避けるため、前の値を見る処理は必ず setState の更新関数の中に置く）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 残り秒。**締切はサーバーが送ってくる**（旧実装は計算しながら送っておらず、
  // 操作していないのに試合が進むように見えていた）。
  useEffect(() => {
    if (!clock) { setSeconds(0); return; }
    const tick = () => setSeconds(Math.max(0, Math.ceil((clock.deadlineTs - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [clock]);

  const queue = useCallback(() => {
    if (!socket.connected) socket.connect();
    modeRef.current = mode;
    socket.emit("match:queue", { mode, name: getProfileName() });
    setPhase("queued");
  }, [mode]);
  const cancel = useCallback(() => { socket.emit("match:cancel"); setPhase("idle"); }, []);

  const onPickCard = useCallback((card) => {
    if (pickedRef.current) return; // 出し直しは認めない（サーバー側でも弾いている）
    pickedRef.current = card;
    setPicked(card);
    setClock(null);
    socket.emit("match:card_pick", { cardId: card.id });
  }, []);
  const onChooseKj = useCallback((m) => socket.emit("match:kj_choose", { mode: m }), []);
  const onBetAction = useCallback((action, fraction) => {
    setClock(null);
    socket.emit("match:bet_action", { action, fraction });
  }, []);

  if (phase === "idle" || phase === "queued") {
    return (
      <MatchLobbyView mode={mode} waiting={phase === "queued"} notice={notice}
        onStart={queue} onCancel={cancel} onExit={onExit} onModeChange={setMode} />
    );
  }
  if (phase === "end" && ending) {
    return (
      <MatchEndView ending={ending} totalLives={info?.lives ?? MODES[mode]?.lives ?? 0} outcome={outcome}
        onRestart={() => { setPhase("idle"); setInfo(null); }} onExit={onExit} />
    );
  }
  return (
    <MatchBoard
      selfName={getProfileName()} opponentName={info?.opponent?.name ?? "相手"}
      totalLives={info?.lives ?? 0} totalRounds={info?.rounds}
      round={round} kj={kj} picked={picked} opponentPicked={opponentPicked}
      bet={bet} reveal={reveal} phase={phase}
      roundLog={roundLog} notice={notice}
      seconds={clock ? seconds : 0} timerTotal={Math.round((clock?.timeoutMs ?? 15000) / 1000)}
      onChooseKj={onChooseKj} onPickCard={onPickCard} onBetAction={onBetAction}
    />
  );
}
