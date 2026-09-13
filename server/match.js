// 1対1の対戦のサーバー。**ルールの進行そのものは shared/match.js が持ち、
// ここは「誰にどこまで見せるか」と「いつまで待つか」だけを担う。**
// CPU練習(client/src/battle/PracticeMatch.jsx)も同じ状態機械を直接回すので、
// このリポジトリが繰り返し痛い目を見た「同じルールを2箇所に実装する」が起きない。
//
// ── 旧 server/tournament.js との違い ──
// 1. **CPUで席を埋めない**。相手は必ず人間で、揃うまで待つ。16人前提で作られた
//    ロビー(LOBBY_TIMEOUT_MS / filledCount / easeOutCubicの疑似席埋まり演出)は丸ごと不要になる。
//    farm抑止のためのCPU強度連動(CPU_SKILL_BY_RANK)も、RPが人間相手からしか動かなくなるので不要。
// 2. **両者とも人間**なので、待つべき入力が常に2人ぶんある。旧実装で「締切を計算しているのに
//    クライアントへ送っていない」という不具合があった（操作していないのに試合が進むように見えた）。
//    **このファイルでは締切を張るたびに必ず送る**——armDeadline()がその唯一の入口。
import { randomUUID } from "node:crypto";
import { MODES } from "../shared/engine.js";
import {
  PHASE, createMatch, other, potOf, beginRound, declareKJ, autoDeclareKJ,
  pickCard, autoPickCard, bothPicked, beginBetting, betAction, betContext,
  bettingExhausted, resolveRound, forfeit, anteOfRound,
} from "../shared/match.js";
// **進行の「間」の尺はクライアントと同じ場所から読む**（shared/pacing.js のコメント参照）。
import { NEXT_ROUND_DELAY_MS, ALL_IN_HOLD_MS } from "../shared/pacing.js";

// **環境変数は使う瞬間に読むこと。** モジュール先頭の定数で受けると、ESMのimportは評価が先に
// 走るぶん、テスト側が process.env を書き換えるより早く確定してしまう（実際に踏んだ:
// テストが本番の10〜15秒タイムアウトで動いてハングした）。
const kjTimeoutMs = () => Number(process.env.KJ_CHOICE_TIMEOUT_MS) || 10000;
const cardTimeoutMs = () => Number(process.env.CARD_SELECT_TIMEOUT_MS) || 15000;
const betTimeoutMs = () => Number(process.env.BET_ACTION_TIMEOUT_MS) || 15000;


const queues = new Map();  // modeId -> [socket]
const sessions = new Map(); // matchId -> { m, players, timer, nextTimer, deadlineTs }

// ─── マッチメイキング ───

export function joinQueue(io, socket, { mode, name, title } = {}) {
  const modeId = MODES[mode] ? mode : "ranked";
  socket.data.name = (name || "プレイヤー").slice(0, 16);
  socket.data.title = title || null;

  // **新しい試合を申し込む人が、古い試合に残っていてはいけない。**
  // 対戦中に画面を離れる経路（下部ナビの「ホーム」など）ではソケットが繋がったままなので
  // disconnect が起きず、クライアントが match:leave を送り忘れると2つの試合に同時に属する
  // ——古い試合の match:end が、いま遊んでいる試合の最中に届く（再現済み）。
  // クライアント側でも送るが、**サーバーが最後の砦**として畳む。
  if (socket.data.matchId && sessions.has(socket.data.matchId)) leaveMatch(io, socket);

  leaveQueue(io, socket, { silent: true });
  const q = queues.get(modeId) || [];
  queues.set(modeId, q);

  // 相手が既に待っていれば即成立。いなければ待機（**CPUで埋めない**）。
  // **切れたソケットは捨てて次を見ること。** 1つ取り出して駄目なら諦める書き方だと、
  // 列の先頭に死んだソケットが1つあるだけで、後ろに生きている人が居ても成立しなくなる。
  let opponent = q.shift();
  while (opponent && (!opponent.connected || opponent.id === socket.id)) opponent = q.shift();
  if (opponent) {
    startMatch(io, opponent, socket, MODES[modeId]);
    return;
  }
  q.push(socket);
  socket.emit("match:queued", { mode: modeId, waiting: q.length });
}

export function leaveQueue(io, socket, { silent = false } = {}) {
  for (const [modeId, q] of queues) {
    const i = q.findIndex((s) => s.id === socket.id);
    if (i >= 0) q.splice(i, 1);
    if (q.length === 0) queues.delete(modeId);
  }
  if (!silent) socket.emit("match:queue_left", {});
}

function startMatch(io, sockA, sockB, mode) {
  const id = randomUUID();
  const ids = [sockA.id, sockB.id];
  const s = {
    m: createMatch({ ids, lives: mode.lives, rounds: mode.rounds }),
    players: {
      [sockA.id]: { socketId: sockA.id, name: sockA.data.name, title: sockA.data.title },
      [sockB.id]: { socketId: sockB.id, name: sockB.data.name, title: sockB.data.title },
    },
    mode, timer: null, nextTimer: null, deadlineTs: 0,
  };
  sessions.set(id, s);

  for (const sock of [sockA, sockB]) {
    sock.data.matchId = id;
    sock.join(id);
    const opp = s.players[other(s.m, sock.id)];
    sock.emit("match:found", {
      matchId: id, mode: mode.id, lives: mode.lives, rounds: mode.rounds,
      opponent: { name: opp.name, title: opp.title },
    });
  }
  openRound(io, id);
}

// ─── 配信のヘルパー ───

const pub = (c) => (c ? { id: c.id, kind: c.kind, number: c.number } : null);
const to = (io, s, pid, ev, payload) => io.to(s.players[pid].socketId).emit(ev, payload);

function clearTimers(s) {
  clearTimeout(s.timer); s.timer = null;
  clearTimeout(s.nextTimer); s.nextTimer = null;
}

// **締切を張る唯一の入口。** ここを通さずに setTimeout を書かないこと——
// 旧実装は締切を計算しながらクライアントへ送っておらず、「操作していないのに進む」という
// 見え方になっていた。設定と emit を同じ関数に閉じておけば、送り忘れが構造的に起きない。
function armDeadline(io, s, ms, targets, event, onTimeout) {
  s.deadlineTs = Date.now() + ms;
  s.timer = setTimeout(onTimeout, ms);
  for (const pid of targets) to(io, s, pid, event, { deadlineTs: s.deadlineTs, timeoutMs: ms });
}

// ─── 局の進行 ───

function openRound(io, matchId) {
  const s = sessions.get(matchId); if (!s) return;
  clearTimers(s);
  if (!beginRound(s.m)) return finish(io, matchId);

  const m = s.m;
  for (const pid of m.ids) {
    const opp = other(m, pid);
    to(io, s, pid, "match:round_start", {
      round: m.round, suddenDeath: m.suddenDeath,
      // **アンティは宣言より前に知らせること。** 最終局だけ額が上がるので、
      // それを知らずに KING/JOKER を選ばせると、いちばん大きい局だけ手探りになる。
      ante: anteOfRound(m),
      yourLives: m.lives[pid], opponentLives: m.lives[opp],
      // **自分の手札は実物、相手はUP/DOWNの内訳だけ。** これがこのゲームの情報設計そのものなので、
      // 相手のカードを載せないこと（開示は決着後の match:reveal の仕事）。
      yourHand: m.hands[pid].map(pub),
      yourBands: m.bands[pid], opponentBands: m.bands[opp],
      youChoose: m.chooserId === pid,
    });
  }
  armDeadline(io, s, kjTimeoutMs(), [m.chooserId], "match:kj_deadline", () => {
    const cur = sessions.get(matchId); if (!cur || cur.m.phase !== PHASE.KJ) return;
    autoDeclareKJ(cur.m);
    afterKJ(io, matchId);
  });
}

export function submitKJChoice(io, matchId, playerId, mode) {
  const s = sessions.get(matchId); if (!s) return;
  if (s.m.chooserId !== playerId) return;
  if (!declareKJ(s.m, mode)) return;
  clearTimers(s);
  afterKJ(io, matchId);
}

function afterKJ(io, matchId) {
  const s = sessions.get(matchId); if (!s) return;
  clearTimers(s);
  const m = s.m;
  for (const pid of m.ids) {
    to(io, s, pid, "match:kj_result", {
      mode: m.kjMode, chooserName: s.players[m.chooserId].name, youChose: m.chooserId === pid,
    });
  }
  // 宣言のあとに両者が同時にカードを選ぶ。**宣言を先に見せる**ことで、
  // 「どちらが勝ちなのか」を知ったうえでの選択になり、公表との読み合いが噛み合う。
  armDeadline(io, s, cardTimeoutMs(), m.ids, "match:card_deadline", () => {
    const cur = sessions.get(matchId); if (!cur || cur.m.phase !== PHASE.CARD) return;
    for (const pid of cur.m.ids) autoPickCard(cur.m, pid);
    openBetting(io, matchId);
  });
}

export function submitCardPick(io, matchId, playerId, cardId) {
  const s = sessions.get(matchId); if (!s) return;
  if (!pickCard(s.m, playerId, cardId)) return;
  for (const pid of s.m.ids) {
    to(io, s, pid, "match:card_locked", {
      youLocked: !!s.m.picks[pid], opponentLocked: !!s.m.picks[other(s.m, pid)],
    });
  }
  if (bothPicked(s.m)) { clearTimers(s); openBetting(io, matchId); }
}

function openBetting(io, matchId) {
  const s = sessions.get(matchId); if (!s) return;
  clearTimers(s);
  beginBetting(s.m);
  broadcastBet(io, s, null, null);
  advanceBetting(io, matchId);
}

function broadcastBet(io, s, lastAction, actorName) {
  const m = s.m;
  for (const pid of m.ids) {
    const opp = other(m, pid);
    to(io, s, pid, "match:bet_update", {
      pot: potOf(m),
      yourWager: m.contrib[pid], opponentWager: m.contrib[opp],
      yourLives: m.lives[pid], opponentLives: m.lives[opp],
      pendingRaise: m.pendingRaise,
      // **コール額はサーバーが配る。** クライアントがポットから割り直すと、レイズ後のポットで
      // 計算してしまい表示と実際の引き落としがズレる。
      pendingAmount: m.pendingAmount,
      // **ボタンに出す額は盤面の拠出から取ること。** pendingAmount は相手が「積もうとした額」で、
      // 1局の拠出の上限(roundBetCap)で切られると実際に積まれた額と食い違う
      // ——実測でコールの14.2%がこれに当たっていた。room はこちらのレイズを切る側で同じ話。
      toCall: betContext(m, pid).toCall, room: betContext(m, pid).room,
      // この局はベットが1手も成立しない（どちらかが残り1ライフで、アンティが上限そのもの）。
      allIn: m.phase === PHASE.BETTING && bettingExhausted(m),
      yourTurn: m.phase === PHASE.BETTING && m.turn === pid,
      // レイズ回数の上限は無いが、**オールイン相当まで積み上がると上乗せできない**
      // (拠出の上限は少ない方の残りライフ=effectiveStack)。押しても何も起きないボタンを
      // 出さないため、その判定はサーバーが配る。
      canRaise: betContext(m, pid).canRaise,
      lastAction, actorName,
    });
  }
}

function advanceBetting(io, matchId) {
  const s = sessions.get(matchId); if (!s || s.m.phase !== PHASE.BETTING) return;
  clearTimeout(s.timer);
  // 両者オールイン（積む余地が無い）。**同じtickで畳まないこと。**
  // カードを選んだ瞬間に決着したようにしか見えず、実測では**試合の28.6%がこの局で終わる**。
  // 一拍だけ置いてポットと「ALL IN」を見せてから開示へ渡す（クライアントは bet_update の
  // allIn でその画を出す）。次の局へ移る時に一拍置くのと同じ理由。
  if (bettingExhausted(s.m)) { s.timer = setTimeout(() => settle(io, matchId), ALL_IN_HOLD_MS); return; }
  armDeadline(io, s, betTimeoutMs(), [s.m.turn], "match:turn_deadline", () => {
    // タイムアウトは**非攻撃的な既定行動**にする（勝手に降りたり積んだりしない）。
    const cur = sessions.get(matchId); if (!cur || cur.m.phase !== PHASE.BETTING) return;
    apply(io, matchId, cur.m.turn, cur.m.pendingRaise ? "call" : "check");
  });
}

export function submitBetAction(io, matchId, playerId, action, fraction) {
  const s = sessions.get(matchId); if (!s || s.m.phase !== PHASE.BETTING) return;
  if (s.m.turn !== playerId) return;
  if (!["check", "call", "raise", "fold"].includes(action)) return;
  clearTimers(s);
  apply(io, matchId, playerId, action, fraction);
}

function apply(io, matchId, playerId, action, fraction) {
  const s = sessions.get(matchId); if (!s) return;
  clearTimers(s);
  const done = betAction(s.m, playerId, action, fraction);
  broadcastBet(io, s, action, s.players[playerId].name);
  if (done) settle(io, matchId);
  else advanceBetting(io, matchId);
}

function settle(io, matchId) {
  const s = sessions.get(matchId); if (!s) return;
  clearTimers(s);
  const m = s.m;
  const r = resolveRound(m);

  for (const pid of m.ids) {
    const opp = other(m, pid);
    to(io, s, pid, "match:reveal", {
      yourCard: pub(r.cards[pid]), opponentCard: pub(r.cards[opp]),
      kjMode: r.kjMode,
      youWonCard: r.cardWinnerId === pid, youWonPot: r.potWinnerId === pid,
      folded: !!r.folded, youFolded: r.folded === pid,
      pot: r.pot, livesMoved: r.moved,
      yourLives: r.lives[pid], opponentLives: r.lives[opp],
    });
  }

  // **決着と同じtickで次の局を始めないこと。** クライアントは決着イベントを受けてから
  // カードをめくって結果を見せるので、即座に次を始めると一番大事な局の結果が一度も見えない
  // （旧実装で実際に起きた不具合）。
  s.nextTimer = setTimeout(
    () => (m.ended ? finish(io, matchId) : openRound(io, matchId)),
    NEXT_ROUND_DELAY_MS,
  );
}

function finish(io, matchId) {
  const s = sessions.get(matchId); if (!s) return;
  clearTimers(s);
  const m = s.m;
  const e = m.ended || { reason: "roundLimit", winnerId: null };
  for (const pid of m.ids) {
    const opp = other(m, pid);
    to(io, s, pid, "match:end", {
      reason: e.reason, youWon: e.winnerId === pid, draw: e.winnerId === null,
      yourLives: Math.max(0, m.lives[pid]), opponentLives: Math.max(0, m.lives[opp]),
      roundsPlayed: m.roundsPlayed, opponentName: s.players[opp].name,
    });
  }
  sessions.delete(matchId);
}

// ─── 切断 ───
// **CPUに引き継がせない**（オンラインにCPUを置かない方針の当然の帰結）。残った側の勝ちで畳む。
export function handleDisconnect(io, socket) {
  leaveQueue(io, socket, { silent: true });
  const matchId = socket.data.matchId;
  const s = matchId && sessions.get(matchId); if (!s) return;
  clearTimers(s);
  const opp = other(s.m, socket.id);
  to(io, s, opp, "match:opponent_left", { opponentName: s.players[socket.id].name });
  forfeit(s.m, socket.id);
  finish(io, matchId);
}

export function leaveMatch(io, socket) {
  handleDisconnect(io, socket);
  socket.data.matchId = null;
}
