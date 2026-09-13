// 「リードした側が残り全部降りれば勝てる」局面がどれだけ起きているかを数え、
// アンティの段（engine.js の ANTE_TIERS）を掃いて比べる。
//
// ── 決着済みの判定 ──
// 消極的に打つ側が1局に失う額は、降りればアンティ（即降りなら拠出はアンティだけ）、
// 降りずに開示しても互いのアンティぶんだけ——つまり**アンティが1局あたりの最大失点**。
// そこで「リード側が毎局きっちりアンティだけ失い続ける」最悪ケースを残り局ぶん転がし、
// **それでも勝っているなら、その時点で勝敗は確定している**（相手が何をしても覆らない）。
// 閉じた式（L >= 2*残り局数+2）ではなく転がすのは、アンティが局と残ライフの両方で変わるため。
//
// **アンティを上げるとベットの余地(room)が減る**ので、消化試合の減り方だけを見て決めないこと。
// 「ベット不能局」「その局で試合が終わる割合」を同じ表に並べてあるのはそのため
// （ベットが1手も成立しない局が、試合の終わり方を左右していた）。
import { MODES, buildShoe, QUEEN_WINDOW_ROUNDS_RATIO, mulberry32, anteFor, roundBetCap } from "../shared/engine.js";
import {
  PHASE, createMatch, beginRound, declareKJ, autoPickCard, beginBetting,
  betAction, bettingExhausted, resolveRound, cpuBetDecision, cpuKJDecision,
} from "../shared/match.js";

const args = process.argv.slice(2);
const val = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const RUNS = Number(val("runs", 20000));
const SEED = Number(val("seed", 12345));
const SECONDS_PER_ROUND = 30;

// 末尾から数えたアンティ。[2,3] = 「残り2局で2、最終局で3、それ以外は1」。
const CANDIDATES = [
  [1],          // 現行（据え置き）
  [2],
  [3],
  [4],
  [1, 3],
  [2, 3],
  [3, 3],
  [2, 4],
  [1, 2, 3],
  [2, 2, 3],
  [2, 3, 4],
];

const pct1 = (n, d) => (d === 0 ? "0.0" : ((n / d) * 100).toFixed(1));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };

// リード側が毎局アンティだけ失い続ける最悪ケースを転がす。true = もう覆らない。
function alreadyDecided(m, tiers) {
  let lead = Math.max(m.lives.a, m.lives.b);
  let trail = Math.min(m.lives.a, m.lives.b);
  if (lead === trail) return false;
  for (let r = m.round; r <= m.rounds; r++) {
    const cap = Math.min(trail, m.roundCap);
    const ante = Math.min(anteFor(r, m.rounds, tiers), cap);
    lead -= ante; trail += ante;
    if (lead <= 0) return false;   // 削り切られる可能性がある
  }
  return lead > trail;
}

function playMatch(rng, lives, rounds, tiers, s) {
  const m = createMatch({
    ids: ["a", "b"], lives, rounds, rng,
    shoe: buildShoe(rounds, rng, QUEEN_WINDOW_ROUNDS_RATIO), anteTail: tiers,
  });
  const brinkAt = Math.max(1, Math.floor(lives / 3));
  const wasOnBrink = { a: false, b: false };
  let decidedAt = null, deadRounds = 0, lastRoundDecided = false, endedUnbettable = false;
  // **最後に打たれた局が勝負になっていたか。** 結果が未確定で、かつベット段階があった局。
  // 消化試合を減らす対価がベット不能局の増加なので、片方だけ見ていると必ず判断を誤る。
  let lastRoundLive = false;

  while (!m.ended) {
    if (!beginRound(m)) break;
    const decidedNow = alreadyDecided(m, tiers);
    if (m.round === m.rounds) lastRoundDecided = decidedNow;
    if (decidedAt == null && decidedNow) decidedAt = m.round;
    if (decidedAt != null) deadRounds += 1;

    declareKJ(m, cpuKJDecision(m));
    for (const id of m.ids) autoPickCard(m, id);
    beginBetting(m);
    s.rounds += 1;
    const unbettable = bettingExhausted(m);
    if (unbettable) s.noBet += 1;
    lastRoundLive = !decidedNow && !unbettable;
    let guard = 0;
    while (m.phase === PHASE.BETTING && guard++ < 200) {
      if (bettingExhausted(m)) break;
      const id = m.turn;
      const { action, fraction } = cpuBetDecision(m, id);
      betAction(m, id, action, fraction);
    }
    resolveRound(m);
    endedUnbettable = unbettable;   // 最後に打たれた局がベット不能だったか
    for (const id of m.ids) if (m.lives[id] > 0 && m.lives[id] <= brinkAt) wasOnBrink[id] = true;
  }

  const e = m.ended || { reason: "roundLimit", winnerId: null };
  s.matches += 1;
  s.roundsPlayed.push(m.roundsPlayed);
  if (e.reason === "knockout") s.knockout += 1;
  if (m.roundsPlayed <= 1) s.blitz1 += 1;
  if (e.reason === "suddenDeath") s.sudden += 1;
  if (endedUnbettable) s.endedNoBet += 1;
  if (lastRoundLive) s.lastLive += 1;
  if (decidedAt != null) { s.decidedMatches += 1; s.deadRounds += deadRounds; }
  if (m.roundsPlayed >= m.rounds) { s.reachedLast += 1; if (lastRoundDecided) s.lastDead += 1; }
  for (const id of m.ids) {
    if (!wasOnBrink[id]) continue;
    s.brinkFaced += 1;
    if (e.winnerId === id) s.brinkSurvived += 1;
  }
}

const newStats = () => ({
  matches: 0, rounds: 0, noBet: 0, endedNoBet: 0, roundsPlayed: [], knockout: 0, blitz1: 0, sudden: 0,
  decidedMatches: 0, deadRounds: 0, reachedLast: 0, lastDead: 0, lastLive: 0, brinkFaced: 0, brinkSurvived: 0,
});

for (const [id, mode] of Object.entries(MODES)) {
  console.log(`\n══ ${id.toUpperCase()}  ライフ${mode.lives} / ${mode.rounds}局  ${RUNS}試合 ══`);
  console.log("                       ★これが総合   ── 直したいもの ───────   ── 払う対価 ─────  ── ガードレール ──────");
  console.log("  アンティ段    上限   最後の局が    決着済み 消化局 最終局が   ベット  その局で  ノック  逆転   中央  推定");
  console.log("                       勝負だった    の試合  /全局  確定済み   不能局  試合終了  アウト  率     局数  分");
  for (const tiers of CANDIDATES) {
    const rng = mulberry32(SEED);
    const s = newStats();
    for (let i = 0; i < RUNS; i++) playMatch(rng, mode.lives, mode.rounds, tiers, s);
    const sched = [];
    for (let r = 1; r <= mode.rounds; r++) sched.push(anteFor(r, mode.rounds, tiers));
    const minutes = (s.roundsPlayed.reduce((x, y) => x + y, 0) / s.matches) * SECONDS_PER_ROUND / 60;
    console.log(
      `  ${JSON.stringify(tiers).padEnd(12)} ${String(roundBetCap(mode.lives, null, tiers)).padStart(3)}   ` +
      `${pct1(s.lastLive, s.matches).padStart(8)}%    ` +
      `${pct1(s.decidedMatches, s.matches).padStart(5)}% ${pct1(s.deadRounds, s.rounds).padStart(5)}%  ` +
      `${pct1(s.lastDead, s.reachedLast).padStart(5)}%     ` +
      `${pct1(s.noBet, s.rounds).padStart(5)}%  ${pct1(s.endedNoBet, s.matches).padStart(5)}%   ` +
      `${pct1(s.knockout, s.matches).padStart(5)}%  ${pct1(s.brinkSurvived, s.brinkFaced).padStart(5)}%  ` +
      `${String(median(s.roundsPlayed)).padStart(4)} ${minutes.toFixed(1).padStart(5)}`,
    );
    console.log(`       アンティ ${sched.join(",")}`);
  }
}
console.log("\n  ガードレール: ノックアウト55〜80% / 逆転8%以上 / 1局決着0% / 推定 カジュアル1.5〜3.0分・ランク3〜5分");
console.log("  [1,1,1,1] が現行。決着済み＝リード側が毎局アンティだけ失い続けても勝てる状態。\n");
