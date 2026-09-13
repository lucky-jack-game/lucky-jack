// 1対1の対戦の経済シミュレーション。実際のルールエンジン(shared/engine.js)で
// CPU同士の試合を回し、下の TARGETS で定義した**5つの指標**を実測する。
//
// **UIを1行も書く前にライフ数とラウンド数を確定させるためのツール。** 6ライフ/12ラウンドは
// 出発点として妥当だが直感で決めてよい数字ではない——最小ベットのみで進む場合、ライフ差は
// ±1のランダムウォークになり、引き分け23% > ノックアウト18% になることが計算で分かっている
// （設計書4-2）。実際にレイズが入るとどうなるかは測るしかない。
//
// 使い方:
//   npm run sim                                  # 既定(ランク20000試合)
//   npm run sim -- --mode casual
//   npm run sim -- --lives 5 --rounds 9          # 候補値を試す（本番コードは変えない）
//   npm run sim -- --sweep                       # ライフ×ラウンドの格子で5指標の対応表
//   npm run sim -- --runs 5000 --seed 42
//
// ── 旧simulate.mjs（16人トーナメント）との関係 ──
// トーナメントの撤廃と一緒に削除した。経済の数値は、いまはこのシミュレータだけで決めている。

import { MODES, buildShoe, cardsDealtInMatch, KJ_PROBS, QUEEN_WINDOW_ROUNDS_RATIO, mulberry32, roundBetCap } from "../shared/engine.js";
import {
  PHASE, createMatch, potOf, beginRound, declareKJ, autoPickCard, beginBetting,
  betAction, betContext, bettingExhausted, resolveRound, cpuBetDecision, cpuKJDecision,
} from "../shared/match.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const val = (name, def) => (flag(name) ? args[args.indexOf(`--${name}`) + 1] : def);

const RUNS = Number(val("runs", 20000));
const SEED = Number(val("seed", 12345));
const MODE = val("mode", "ranked");
const SWEEP = flag("sweep");
// 1局に賭けられるライフの上限（開始ライフに対する比）。未指定なら本番の既定値。
// --capsweep で比だけを掃いて、5指標と1局決着率の対応を見る。
const CAP_RATIO = val("capratio", null) == null ? undefined : Number(val("capratio", null));
const CAP_SWEEP = flag("capsweep");
// Queenを挿す窓（ラウンド上限に対する比）。登場率と「出る時期が読めない」ことのトレードオフ。
const QWIN = Number(val("qwin", QUEEN_WINDOW_ROUNDS_RATIO));

const baseMode = MODES[MODE] || MODES.ranked;
const LIVES = Number(val("lives", baseMode.lives));
const ROUNDS = Number(val("rounds", baseMode.rounds));

// KING/JOKER選択確率の候補値。**現在は状態機械(match.js)の内側で chooseKJMode を
// 呼んでいるため、ここから差し替えられない。** 試すときは engine.js の KJ_PROBS を
// 直接書き換えて測ること（測定と本番コードを一致させる方を優先した）。
const KJ_ARG = val("kj", null);
if (KJ_ARG) console.log("警告: --kj は現在無効です。engine.js の KJ_PROBS を直接変えてください");
void KJ_PROBS;

// ─── 合否のガードレール（数字の良し悪しはここだけが決める） ───
// **1ラウンドの実時間の見積もり。** KING/JOKER選択＋カード選択＋ベットループ＋開示＋結果で、
// 対人の思考時間を含めておよそ30秒（現行のCPU練習が15〜25秒で、人間相手はこれより伸びる）。
const SECONDS_PER_ROUND = 30;

// ── 初版の目標のうち3つは誤りだったので差し替えてある（実測して初めて分かった） ──
//
// 1. **「ノックアウト50〜70%」と「逆転率10〜20%」は定義上あべこべを要求していた。**
//    ノックアウトとは短スタックが生還に失敗することそのものなので、この2つは同じ現象の
//    裏表であり、同時に満たす組み合わせは格子上のどこにも存在しなかった。逆転率は
//    ノックアウト率に構造的に上限を縛られるので、**下限だけを持つ片側の目標**にする。
// 2. **「ランク6〜8分」は到達不能だった**（格子の最大でも5.0分）。そもそもWebで遊ぶ対戦ゲームの
//    ランクマッチとして3〜5分は短すぎない——キューの回転が速いことは欠点ではない。
//    最終ゴールがコンテスト提出である以上、長いことに価値は無い。
// 3. **「中央4ラウンド以上」は緩すぎた。** 根拠を「コインフリップにしない」から
//    「UP/DOWNの公表を読む余地が生まれること」に置き直す——相手の申告と実際に出た札を
//    何度か突き合わせて初めて読みが成立するので、ランクは6局は要る。
// 4. **カジュアルの「1.5〜2.5分」は1局の拠出上限(roundBetCap)を入れた時点で到達不能になった。**
//    上限を入れる＝ノックアウトに最低2局を要求することなので、試合が伸びるのは目標との
//    偶然の衝突ではなく**その変更の定義そのもの**。格子を掃いても、ノックアウト率55%以上を
//    保ったまま2.5分に収まる (ライフ, ラウンド) の組は1つも存在しない。
//    「1局で終わりうる」ことと「常に2.5分以内」は同時には買えないので、**1局で終わらせない方を
//    優先**して上限を3.0分へ引き直す。下限は据え置き。
const TARGETS = {
  knockout: [0.55, 0.8],
  medianRounds: [MODE === "casual" ? 4 : 6, Infinity],
  suddenDeath: [0, 0.05],
  comeback: [0.08, 1],
  minutes: MODE === "casual" ? [1.5, 3.0] : [3, 5],
};

// ─── 1試合 ───
// **進行は shared/match.js をそのまま回す。** 以前はここに独自のベットループを
// 持っていたが、それだと"測った数字"と"実際に動くコード"が別物になる——このリポジトリが
// 繰り返し痛い目を見た「同じルールを2箇所に実装する」そのものだった。
// サーバー(server/match.js)もCPU練習(client/src/battle/PracticeMatch.jsx)も同じものを回すので、
// ここで出る数字はそのまま本番の数字になる。
function playMatch(rng, { lives, rounds, capRatio }, stats) {
  const m = createMatch({ ids: ['a', 'b'], lives, rounds, rng, shoe: buildShoe(rounds, rng, QWIN), capRatio });
  // 逆転率の判定用。**「ライフ1まで落ちた」で数えないこと**——その定義はスタックの深さに
  // 依存し、ライフを増やすほど「1まで落ちる」自体が稀になるので、逆転が増えても数字が下がる。
  // 開始ライフの1/3以下まで削られたか、で見ればスケール不変になる。
  const brinkAt = Math.max(1, Math.floor(lives / 3));
  const wasOnBrink = { a: false, b: false };
  let queenSeen = false;

  while (!m.ended) {
    if (!beginRound(m)) break;
    declareKJ(m, cpuKJDecision(m));
    stats.kj[m.kjMode] += 1;
    for (const id of m.ids) autoPickCard(m, id);
    if (m.picks.a.kind === 'queen' || m.picks.b.kind === 'queen') queenSeen = true;

    beginBetting(m);
    let raises = 0, guard = 0;
    while (m.phase === PHASE.BETTING && guard++ < 200) {
      if (bettingExhausted(m)) break;
      const id = m.turn;
      const { action, fraction } = cpuBetDecision(m, id);
      if (action === 'raise' && betContext(m, id).canRaise) raises += 1;
      betAction(m, id, action, fraction);
    }

    stats.pots.push(potOf(m));
    stats.raises.push(raises);
    if (m.contrib.a >= m.cap && m.contrib.b >= m.cap) stats.allIn += 1;
    // 不変条件: 降りずに決着した局は両者の拠出が一致する。
    if (!m.folded) stats.betGaps.push(Math.abs(m.contrib.a - m.contrib.b));
    else stats.folds += 1;

    resolveRound(m);
    for (const id of m.ids) if (m.lives[id] > 0 && m.lives[id] <= brinkAt) wasOnBrink[id] = true;
  }

  const e = m.ended || { reason: 'roundLimit', winnerId: null };
  const outcome = e.reason === 'knockout' ? 'knockout' : e.reason === 'suddenDeath' ? 'suddenDeath' : 'roundLimit';
  stats.outcomes[outcome] += 1;
  stats.roundsPlayed.push(m.roundsPlayed);
  // **「一瞬で終わる」を正面から数える指標。** ノックアウト率や中央ラウンド数は平均の話しか
  // しないので、1局や2局で畳まれる試合がどれだけ紛れているかは見えない（実際に見えていなかった）。
  // 審査員が触るのは1〜2試合なので、代表値ではなく**最悪ケースの頻度**が効く。
  if (m.roundsPlayed <= 1) stats.blitz1 += 1;
  if (m.roundsPlayed <= 2) stats.blitz2 += 1;
  stats.shoeUsed.push(m.shoeIdx);
  if (queenSeen) stats.queenSeen += 1;
  if (e.winnerId) stats.decided += 1;

  // 逆転率は **P(勝つ | 崖に立った)** で数える。「勝者が崖に立っていた割合」で数えると
  // 崖に立つ頻度そのものが混ざり、「逆転しやすさ」を測っていないことになる。
  for (const id of m.ids) {
    if (!wasOnBrink[id]) continue;
    stats.brinkFaced += 1;
    if (e.winnerId === id) stats.brinkSurvived += 1;
  }
}

// ─── 集計 ───
function newStats() {
  return {
    outcomes: { knockout: 0, roundLimit: 0, suddenDeath: 0 },
    roundsPlayed: [], pots: [], raises: [], betGaps: [], shoeUsed: [],
    kj: { king: 0, joker: 0 },
    folds: 0, allIn: 0, decided: 0, queenSeen: 0, brinkFaced: 0, brinkSurvived: 0,
    blitz1: 0, blitz2: 0,
  };
}
const pct = (n, d) => (d === 0 ? "0.0%" : `${((n / d) * 100).toFixed(1)}%`);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const maxOf = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

function run(lives, rounds, runs, seed, capRatio = CAP_RATIO) {
  const rng = mulberry32(seed);
  const stats = newStats();
  for (let i = 0; i < runs; i++) playMatch(rng, { lives, rounds, capRatio }, stats);
  const total = runs;
  return {
    lives, rounds, stats, capRatio,
    blitz1: stats.blitz1 / total,
    blitz2: stats.blitz2 / total,
    knockout: stats.outcomes.knockout / total,
    roundLimit: stats.outcomes.roundLimit / total,
    suddenDeath: stats.outcomes.suddenDeath / total,
    medianRounds: median(stats.roundsPlayed),
    meanRounds: mean(stats.roundsPlayed),
    comeback: stats.brinkFaced ? stats.brinkSurvived / stats.brinkFaced : 0,
    minutes: (mean(stats.roundsPlayed) * SECONDS_PER_ROUND) / 60,
  };
}

function verdict(name, value, [lo, hi]) {
  const ok = value >= lo && value <= hi;
  return `${ok ? "  OK " : "  NG "} ${name}`;
}

// ─── 出力 ───
if (CAP_SWEEP) {
  console.log(`1局の拠出上限の比 × モード（各${RUNS}試合）\n`);
  console.log("モード   比    上限  ノックアウト  1局決着  2局以内  中央R  推定分  逆転率  オールイン  最大レイズ");
  console.log("─".repeat(96));
  for (const modeId of ["casual", "ranked"]) {
    const md = MODES[modeId];
    for (const ratio of [1, 0.86, 0.75, 0.67, 0.6, 0.5]) {
      const r = run(md.lives, md.rounds, RUNS, SEED, ratio);
      const s = r.stats;
      console.log(
        `${modeId.padEnd(8)} ${String(ratio).padStart(4)} ${String(roundBetCap(md.lives, ratio)).padStart(5)}` +
        `  ${pct(r.knockout, 1).padStart(11)}  ${pct(r.blitz1, 1).padStart(7)}  ${pct(r.blitz2, 1).padStart(7)}` +
        `  ${String(r.medianRounds).padStart(5)}  ${r.minutes.toFixed(1).padStart(5)}  ${pct(r.comeback, 1).padStart(6)}` +
        `  ${pct(s.allIn, s.pots.length).padStart(9)}  ${String(maxOf(s.raises)).padStart(9)}`,
      );
    }
  }
  console.log("\n比=1 が上限なし（従来）。上限は開始ライフ×比の切り上げ＝「1局で失えるライフの最大」。");
  process.exit(0);
}

if (SWEEP) {
  console.log(`ライフ × ラウンド上限 の格子（各${RUNS}試合、mode=${MODE}の目標で判定）\n`);
  console.log("ライフ ラウンド  ノックアウト  ラウンド上限  サドンデス  中央R  平均R  推定分  逆転率  2局以内");
  console.log("─".repeat(93));
  for (const lives of [3, 4, 5, 6, 7, 8]) {
    for (const rounds of [6, 9, 12, 15]) {
      const r = run(lives, rounds, RUNS, SEED);
      const mark = r.knockout >= TARGETS.knockout[0] && r.knockout <= TARGETS.knockout[1]
        && r.suddenDeath <= TARGETS.suddenDeath[1] && r.medianRounds >= TARGETS.medianRounds[0] ? " ←" : "";
      console.log(
        `${String(lives).padStart(5)} ${String(rounds).padStart(8)}  ${pct(r.knockout, 1).padStart(11)}` +
        `  ${pct(r.roundLimit, 1).padStart(11)}  ${pct(r.suddenDeath, 1).padStart(9)}` +
        `  ${String(r.medianRounds).padStart(5)}  ${r.meanRounds.toFixed(1).padStart(5)}` +
        `  ${r.minutes.toFixed(1).padStart(5)}  ${pct(r.comeback, 1).padStart(6)}  ${pct(r.blitz2, 1).padStart(6)}${mark}`,
      );
    }
  }
  console.log("\n← は ノックアウト率・サドンデス率・中央ラウンド数 の3つを同時に満たす組み合わせ。");
  process.exit(0);
}

const t0 = Date.now();
const r = run(LIVES, ROUNDS, RUNS, SEED);
const s = r.stats;
const ms = Date.now() - t0;

console.log(`\n1対1の対戦  ライフ${LIVES} / ラウンド上限${ROUNDS}  ${RUNS}試合  (${ms}ms, seed=${SEED})\n`);

// 目標値の表示は必ずTARGETSから作ること。**初版は目標のレンジを文字列で直書きしていて、
// TARGETSを直した後も古い値を表示し続けた**（判定はOK/NGなのに横に違う数字が並ぶ状態になった）。
const asPct = ([lo, hi]) => `${(lo * 100).toFixed(0)}〜${hi >= 1 ? 100 : (hi * 100).toFixed(0)}%`;
console.log(`── 5指標（ガードレール、mode=${MODE}）`);
console.log(`   ノックアウト決着率        ${pct(r.knockout, 1).padStart(6)}   目標 ${asPct(TARGETS.knockout)}`);
console.log(`   打たれたラウンド数 中央   ${String(r.medianRounds).padStart(6)}   目標 ${TARGETS.medianRounds[0]}以上   (平均 ${r.meanRounds.toFixed(2)})`);
console.log(`   サドンデス率              ${pct(r.suddenDeath, 1).padStart(6)}   目標 ${(TARGETS.suddenDeath[1] * 100).toFixed(0)}%以下`);
console.log(`   逆転率(崖から生還して勝つ)${pct(r.comeback, 1).padStart(6)}   目標 ${(TARGETS.comeback[0] * 100).toFixed(0)}%以上`);
console.log(`   推定プレイ時間            ${r.minutes.toFixed(1).padStart(4)}分   目標 ${TARGETS.minutes[0]}〜${TARGETS.minutes[1]}分  (1ラウンド${SECONDS_PER_ROUND}秒換算)`);
// **「一瞬で終わる」は代表値では見えない。** 中央ラウンド数が5でも、1局で畳まれる試合が
// 12%紛れていれば審査員の1試合目がそれになりうる。上限(roundBetCap)を入れた目的そのものなので、
// 5指標の隣に常設して回帰したら気付けるようにする。
console.log(`   1局で決着した試合          ${pct(r.blitz1, 1).padStart(5)}   目標 0%（1局の拠出上限がこれを構造的に0にする）`);
console.log(`   2局以内で決着した試合      ${pct(r.blitz2, 1).padStart(5)}`);
console.log("");
console.log(verdict("ノックアウト決着率", r.knockout, TARGETS.knockout));
console.log(verdict("打たれたラウンド数の中央値", r.medianRounds, TARGETS.medianRounds));
console.log(verdict("サドンデス率", r.suddenDeath, TARGETS.suddenDeath));
console.log(verdict("逆転率", r.comeback, TARGETS.comeback));
console.log(verdict("推定プレイ時間", r.minutes, TARGETS.minutes));
console.log(verdict("1局決着ゼロ", r.blitz1, [0, 0]));

console.log("\n── 決着の内訳");
console.log(`   ノックアウト ${pct(s.outcomes.knockout, RUNS)} / ラウンド上限 ${pct(s.outcomes.roundLimit, RUNS)} / サドンデス ${pct(s.outcomes.suddenDeath, RUNS)}`);

const games = s.pots.length;
console.log("\n── 局の中身");
console.log(`   総局数 ${games}   KING ${pct(s.kj.king, games)} / JOKER ${pct(s.kj.joker, games)}`);
console.log(`   フォールド率 ${pct(s.folds, games)}   オールイン率 ${pct(s.allIn, games)}`);
console.log(`   ポット 平均 ${mean(s.pots).toFixed(2)}ライフ / 中央 ${median(s.pots)} / 最大 ${maxOf(s.pots)}`);
console.log(`   1局のレイズ回数 平均 ${mean(s.raises).toFixed(2)} / 最大 ${maxOf(s.raises)}`);

console.log("\n── シューの消費");
console.log(`   配った枚数 平均 ${mean(s.shoeUsed).toFixed(1)} / 上限 ${cardsDealtInMatch(ROUNDS)}枚（Queenは必ずこの範囲に入る）`);
console.log(`   Queenが場に出た試合 ${pct(s.queenSeen, RUNS)}`);

// ─── 不変条件 ───
// 旧simulate.mjsと同じ形で常設する。降りずに決着した局は両者のベット拠出が一致していなければ
// ならない——一致していないと「コールするより、もう一段レイズし返す方が常に得」という
// 一方向の歪みが生まれる（旧実装で実際に起きていた。raiseCostのコメント参照）。
const gapMax = s.betGaps.reduce((m, v) => Math.max(m, v), 0);
const gapBad = s.betGaps.filter((v) => v !== 0).length;
console.log("\n── 不変条件: 降りずに決着した局は両者の拠出が一致");
console.log(`   ${gapBad === 0 ? "OK" : "NG"}  不一致 ${gapBad}/${s.betGaps.length} 件、最大差 ${gapMax}ライフ`);
// Queenの登場率は100%にはできない（試合がラウンド上限まで行かないため。engine側のコメント参照）。
// 窓を狭めれば上がるが出る時期が読めるようになるので、下限だけ見る。
const QUEEN_FLOOR = 0.85;
console.log(`   ${s.queenSeen / RUNS >= QUEEN_FLOOR ? "OK" : "NG"}  Queen登場率 ${pct(s.queenSeen, RUNS)}（下限 ${QUEEN_FLOOR * 100}% / 窓 qwin=${QWIN}）`);
console.log("");
