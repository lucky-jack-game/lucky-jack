// server/match.js の統合テスト。**実際にSocket.ioサーバーを立てて、2つのクライアントを繋いで
// 局を通す。** ロジックだけを直接呼ぶ形にしないのは、旧実装で繰り返し起きた不具合がどれも
// 「サーバーが計算しているのにクライアントへ送っていない」「決着と同じtickで次を始めていた」
// という**配信と順序の問題**で、関数を直接呼ぶテストでは1つも捕まらない種類だったため。
//
// socket.io-client はクライアント側の依存なので、そこから読む（サーバーに開発用依存を足さない）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createRequire } from "node:module";
import {
  joinQueue, leaveQueue, submitKJChoice, submitCardPick, submitBetAction, handleDisconnect, leaveMatch,
} from "./match.js";
import { MODES, ANTE } from "../shared/engine.js";

const require = createRequire(import.meta.url);
const { io: ioClient } = require("../client/node_modules/socket.io-client/build/cjs/index.js");

// 待ち時間を詰めて、テストが本番のタイムアウト(10〜15秒)に付き合わないようにする。
// **match.js側は環境変数を「使う瞬間に」読むこと**——モジュール先頭の定数で受けると、
// ESMのimportが先に評価されるぶんここの代入が間に合わない（実際に踏んでハングした）。
process.env.KJ_CHOICE_TIMEOUT_MS = "400";
process.env.CARD_SELECT_TIMEOUT_MS = "400";
process.env.BET_ACTION_TIMEOUT_MS = "400";

function bootServer() {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: "*" } });
  io.on("connection", (socket) => {
    socket.data.name = "プレイヤー";
    socket.on("match:queue", (p) => joinQueue(io, socket, p));
    socket.on("match:cancel", () => leaveQueue(io, socket));
    socket.on("match:leave", () => leaveMatch(io, socket));
    socket.on("match:kj_choose", ({ mode } = {}) => submitKJChoice(io, socket.data.matchId, socket.id, mode));
    socket.on("match:card_pick", ({ cardId } = {}) => submitCardPick(io, socket.data.matchId, socket.id, cardId));
    socket.on("match:bet_action", ({ action, fraction } = {}) =>
      submitBetAction(io, socket.data.matchId, socket.id, action, fraction));
    socket.on("disconnect", () => handleDisconnect(io, socket));
  });
  return new Promise((resolve) => {
    httpServer.listen(0, () => resolve({ io, httpServer, port: httpServer.address().port }));
  });
}

// **受信は必ずバッファすること。** once()を張ってから待つ方式だと、サーバーが同じtickで
// 続けて emit するイベント（match:found の直後の match:round_start など）を、
// 前のイベントを await している間に取りこぼす。これはテストハーネス固有の問題で、
// 本物のクライアントはハンドラをマウント時に全部張るので起きない。
function connect(port, name) {
  const sock = ioClient(`http://localhost:${port}`, { transports: ["websocket"], forceNew: true });
  sock.log = [];
  const inbox = new Map();   // ev -> payload[]
  const taken = new Map();   // ev -> 消費済み件数
  const waiters = new Map(); // ev -> resolve[]
  sock.onAny((ev, payload) => {
    sock.log.push({ ev, payload });
    if (!inbox.has(ev)) inbox.set(ev, []);
    inbox.get(ev).push(payload);
    const w = waiters.get(ev);
    if (w && w.length) w.shift()();
  });
  sock.next = (ev, timeout = 4000) => new Promise((resolve, reject) => {
    const tryTake = () => {
      const got = inbox.get(ev) || [];
      const i = taken.get(ev) || 0;
      if (i < got.length) { taken.set(ev, i + 1); return got[i]; }
      return undefined;
    };
    const immediate = tryTake();
    if (immediate !== undefined) return resolve(immediate);
    const t = setTimeout(() => reject(new Error(`${name}: ${ev} が来なかった`)), timeout);
    if (!waiters.has(ev)) waiters.set(ev, []);
    waiters.get(ev).push(() => { clearTimeout(t); resolve(tryTake()); });
  });
  return new Promise((resolve) => sock.on("connect", () => resolve(sock)));
}

// **後片付けは必ずfinallyで行う。** assertが落ちた時にサーバーとソケットが開いたままだと
// `node --test` はプロセスを終了できず、失敗ではなくハングとして現れる（実際に踏んだ）。
async function withMatch(fn) {
  const { io, httpServer, port } = await bootServer();
  const socks = [];
  const track = (s) => { socks.push(s); return s; };
  try {
    await fn({ port, track });
  } finally {
    for (const s of socks) s.close();
    io.close();
    await new Promise((r) => httpServer.close(r));
  }
}

async function pair(port, track) {
  const A = track(await connect(port, "A"));
  const B = track(await connect(port, "B"));
  const foundA = A.next("match:found"), foundB = B.next("match:found");
  A.emit("match:queue", { mode: "casual", name: "あかり" });
  await A.next("match:queued");
  B.emit("match:queue", { mode: "casual", name: "ばんり" });
  return { A, B, foundA: await foundA, foundB: await foundB };
}

// 1局を最後まで進める。betA/betB は「自分の手番だ」と言われた時に返す行動。
async function playRound(A, B, { betA = "check", betB = "check" } = {}) {
  const startA = await A.next("match:round_start");
  const startB = await B.next("match:round_start");
  const chooser = startA.youChoose ? A : B;
  const kjA = A.next("match:kj_result"), kjB = B.next("match:kj_result");
  chooser.emit("match:kj_choose", { mode: "king" });
  await kjA; await kjB;

  const revealA = A.next("match:reveal"), revealB = B.next("match:reveal");
  A.emit("match:card_pick", { cardId: startA.yourHand[0].id });
  B.emit("match:card_pick", { cardId: startB.yourHand[0].id });

  const respond = (sock, action) => sock.on("match:bet_update", (u) => {
    if (u.yourTurn) sock.emit("match:bet_action", { action, fraction: 0.5 });
  });
  respond(A, betA); respond(B, betB);
  const [rA, rB] = [await revealA, await revealB];
  A.off("match:bet_update"); B.off("match:bet_update");
  return { startA, startB, revealA: rA, revealB: rB };
}

test("2人が揃うとマッチが成立し、CPUでは埋めない", async () => await withMatch(async ({ port, track }) => {
  const A = track(await connect(port, "A"));
  A.emit("match:queue", { mode: "casual", name: "ひとり" });
  assert.equal((await A.next("match:queued")).waiting, 1);
  // **相手が来るまで match:found は絶対に来ない**（旧ロビーはここでCPUを座らせていた）。
  await new Promise((r) => setTimeout(r, 700));
  assert.ok(!A.log.some((e) => e.ev === "match:found"), "相手がいないのにマッチが成立した");

  const B = track(await connect(port, "B"));
  const found = A.next("match:found");
  B.emit("match:queue", { mode: "casual", name: "ふたり" });
  const f = await found;
  assert.equal(f.opponent.name, "ふたり");
  assert.equal(f.lives, MODES.casual.lives);
  assert.equal(f.rounds, MODES.casual.rounds);
}));

test("自分の手札は実物、相手はUP/DOWNの内訳だけが届く", async () => await withMatch(async ({ port, track }) => {
  const { A } = await pair(port, track);
  const startA = await A.next("match:round_start");
  assert.equal(startA.yourHand.length, 2);
  assert.ok(startA.yourHand.every((c) => c.kind === "queen" || typeof c.number === "number"));
  // 相手の情報は内訳だけ。**カードそのものが混ざっていないこと**がこのゲームの情報設計の核。
  assert.deepEqual(Object.keys(startA.opponentBands).sort(), ["down", "up"]);
  assert.equal(startA.opponentBands.up + startA.opponentBands.down, 2);
  assert.ok(!("opponentHand" in startA), "相手の手札が漏れている");
  assert.ok(!("opponentCard" in startA), "相手のカードが漏れている");
}));

test("締切は必ずクライアントへ送られる（計算だけして送らない、を防ぐ）", async () => await withMatch(async ({ port, track }) => {
  const { A, B } = await pair(port, track);
  const startA = await A.next("match:round_start");
  await B.next("match:round_start");
  const chooser = startA.youChoose ? A : B;
  // 宣言の締切は宣言する側にだけ届く
  const kjDl = await chooser.next("match:kj_deadline");
  assert.ok(kjDl.deadlineTs > Date.now());
  assert.equal(kjDl.timeoutMs, 400);
  // カード選択の締切は両者に届く
  const cdA = A.next("match:card_deadline"), cdB = B.next("match:card_deadline");
  chooser.emit("match:kj_choose", { mode: "king" });
  assert.ok((await cdA).deadlineTs > Date.now());
  assert.ok((await cdB).deadlineTs > Date.now());
}));

test("放置しても局は進む（宣言・カード選択・ベットすべて代打ちされる）", async () => await withMatch(async ({ port, track }) => {
  const { A, B } = await pair(port, track);
  const revealA = A.next("match:reveal", 8000);
  await A.next("match:round_start"); await B.next("match:round_start");
  const r = await revealA; // 何も操作しない
  assert.ok(r.yourCard && r.opponentCard, "決着後は両者のカードが開示される");
}));

test("1局を通すと両者のカードが開示され、ライフがゼロサムで動く", async () => await withMatch(async ({ port, track }) => {
  const { A, B } = await pair(port, track);
  const { revealA, revealB } = await playRound(A, B);
  assert.equal(revealA.youWonPot, !revealB.youWonPot, "ポットの勝者が両者で食い違っている");
  assert.deepEqual(revealA.yourCard, revealB.opponentCard);
  assert.deepEqual(revealA.opponentCard, revealB.yourCard);
  // ライフ総量は保存される（完全なゼロサム）
  assert.equal(revealA.yourLives + revealA.opponentLives, MODES.casual.lives * 2);
  assert.equal(revealA.livesMoved, ANTE); // 両者チェックならアンティぶんだけ動く
}));

test("降りた側はポットを失うが、本戦の勝敗は判定され開示される", async () => await withMatch(async ({ port, track }) => {
  const { A, B } = await pair(port, track);
  const { revealA, revealB } = await playRound(A, B, { betA: "raise", betB: "fold" });
  assert.ok(revealB.folded && revealB.youFolded, "Bが降りたことになっていない");
  assert.equal(revealA.youWonPot, true);
  assert.equal(revealB.youWonPot, false);
  // **降りてもカードは開示される**（「降りたのが正解だったか」の答え合わせができる）。
  assert.ok(revealB.opponentCard, "降りた側に相手のカードが開示されていない");
  // 本戦の勝敗はポットの勝敗とは別軸で、降りた局でも必ず判定される。
  assert.equal(typeof revealA.youWonCard, "boolean");
  assert.equal(revealA.youWonCard, !revealB.youWonCard);
}));

test("降りずに決着した局は両者の拠出が一致する", async () => await withMatch(async ({ port, track }) => {
  const { A, B } = await pair(port, track);
  // Aがレイズ、Bがコール。**不足分を埋めてから上乗せする**のが効いていれば拠出は揃う。
  const { revealA } = await playRound(A, B, { betA: "raise", betB: "call" });
  assert.equal(revealA.folded, false);
  const last = A.log.filter((e) => e.ev === "match:bet_update").pop().payload;
  assert.equal(last.yourWager, last.opponentWager, "降りていないのに拠出が揃っていない");
  assert.equal(revealA.pot, last.yourWager + last.opponentWager);
}));

test("手番でないプレイヤーのベットは無視される", async () => await withMatch(async ({ port, track }) => {
  const { A, B } = await pair(port, track);
  const startA = await A.next("match:round_start");
  const startB = await B.next("match:round_start");
  (startA.youChoose ? A : B).emit("match:kj_choose", { mode: "king" });
  await A.next("match:kj_result");
  A.emit("match:card_pick", { cardId: startA.yourHand[0].id });
  B.emit("match:card_pick", { cardId: startB.yourHand[0].id });
  const first = await A.next("match:bet_update");
  const idle = first.yourTurn ? B : A;
  idle.emit("match:bet_action", { action: "raise", fraction: 1 });
  await new Promise((r) => setTimeout(r, 250));
  const latest = A.log.filter((e) => e.ev === "match:bet_update").pop().payload;
  assert.equal(latest.pot, first.pot, "手番でない側のレイズが通ってしまった");
}));

test("カードの出し直しは認められない", async () => await withMatch(async ({ port, track }) => {
  const { A, B } = await pair(port, track);
  const startA = await A.next("match:round_start");
  const startB = await B.next("match:round_start");
  (startA.youChoose ? A : B).emit("match:kj_choose", { mode: "king" });
  await A.next("match:kj_result");
  A.emit("match:card_pick", { cardId: startA.yourHand[0].id });
  A.emit("match:card_pick", { cardId: startA.yourHand[1].id }); // 2枚目は無視されるべき
  B.emit("match:card_pick", { cardId: startB.yourHand[0].id });
  const reveal = await A.next("match:reveal");
  assert.deepEqual(reveal.yourCard, startA.yourHand[0]);
}));

test("決着と同じtickで次の局を始めない（結果を見せる間がある）", async () => await withMatch(async ({ port, track }) => {
  const { A, B } = await pair(port, track);
  await playRound(A, B);
  const ts = Date.now();
  await A.next("match:round_start", 8000);
  // NEXT_ROUND_DELAY_MS(3000) はクライアントの開示演出の尺と対応している。
  // ここが0だと、その局の結果が一度も見えないまま次が始まる（旧実装で実際に起きた）。
  assert.ok(Date.now() - ts > 2000, `次の局が早すぎる (${Date.now() - ts}ms)`);
}));

test("切断した側の負けで即座に畳む（CPUに引き継がせない）", async () => await withMatch(async ({ port, track }) => {
  const { A, B } = await pair(port, track);
  await A.next("match:round_start");
  const left = B.next("match:opponent_left"), ended = B.next("match:end");
  A.close();
  assert.equal((await left).opponentName, "あかり");
  const end = await ended;
  assert.equal(end.reason, "forfeit");
  assert.equal(end.youWon, true);
}));

// ─── 画面を離れた人がサーバー側に残り続けないこと ───
// **この画面は下部ナビでいつでもアンマウントされるが、ソケットはアプリ全体で1つ**なので
// disconnect が起きない。クライアントは match:cancel / match:leave を送るが、送り忘れても
// 壊れないよう**サーバー側でも畳む**——下の2件はどちらも実際に再現した不具合。
test("対戦中に離れた人が入り直しても、新旧2つの試合に同時に属さない", async () => await withMatch(async ({ port, track }) => {
  const { A, B } = await pair(port, track);
  await A.next("match:round_start");

  // 画面を離れただけ（match:leaveを送らない）で、そのまま次の対戦を申し込む。
  A.emit("match:queue", { mode: "casual", name: "あかり" });
  // 相手が落ちたことはBへ伝わる（Aが古い試合から外れた＝Bにとっては相手の離脱）。
  assert.equal((await B.next("match:opponent_left")).opponentName, "あかり");
  await B.next("match:end");

  const C = track(await connect(port, "C"));
  const foundA2 = A.next("match:found");
  C.emit("match:queue", { mode: "casual", name: "ちひろ" });
  assert.equal((await foundA2).opponent.name, "ちひろ");

  // 古い試合はもう畳まれているので、Bが落ちてもAには何も飛んでこない。
  const beforeEnds = A.log.filter((e) => e.ev === "match:end").length;
  B.close();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(A.log.filter((e) => e.ev === "match:end").length, beforeEnds,
    "古い試合の終了イベントが、いま遊んでいる試合の最中に届いている");
}));

test("キューに死んだソケットが残っていても、生きている人同士で成立する", async () => await withMatch(async ({ port, track }) => {
  const dead = track(await connect(port, "dead"));
  dead.emit("match:queue", { mode: "casual", name: "ゆうれい" });
  await dead.next("match:queued");
  dead.close();
  await new Promise((r) => setTimeout(r, 150));

  // 列の先頭に死んだソケットが1つあるだけで後ろが成立しなくなる、を防ぐ。
  const A = track(await connect(port, "A"));
  const B = track(await connect(port, "B"));
  const foundA = A.next("match:found"), foundB = B.next("match:found");
  A.emit("match:queue", { mode: "casual", name: "あかり" });
  await A.next("match:queued");
  B.emit("match:queue", { mode: "casual", name: "ばんり" });
  assert.equal((await foundA).opponent.name, "ばんり");
  assert.equal((await foundB).opponent.name, "あかり");
}));
