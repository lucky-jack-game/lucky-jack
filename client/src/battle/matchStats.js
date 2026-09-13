// 1試合ぶんの記録（対戦履歴・実績・報酬）。
//
// **オンライン対戦とCPU練習の両方がここを通る。** 旧実装は同じ集計をオンライン対戦と
// CPU対戦の画面に別々に書いていて、片方だけ直した結果ずっと食い違っていた（連勝の数え方が
// 両方壊れていて壊れ方が逆だった件が典型）。**数え方を増やすときはここだけを触ること。**
//
// 入力は MatchBoard に渡すのと同じ `reveal` の形なので、呼び出し元は決着のたびに
// recordRound(stats, reveal) を1回呼ぶだけでよい。
import {
  addMatchHistory, checkAndUnlockAchievements, addChips, matchReward, isFlawlessWin,
  addBox, getRankRp, setRankRp,
} from "../storage.js";
import { applyRpDelta, RP_PER_MATCH } from "../rank.js";

const isQueen = (c) => c?.kind === "queen";
const isOne = (c) => c?.kind === "number" && c.number === 1;
const isTen = (c) => c?.kind === "number" && c.number === 10;

export function createStats(totalLives) {
  return {
    totalLives,
    // 「崖っぷちから戻ってきたか」を測るための最小値。**決着ごとに更新すること**——
    // 終了時のライフだけ見ても、途中でどこまで追い込まれたかは分からない。
    minLives: totalLives,
    rounds: 0,
    foldsWon: 0,      // 相手を降ろした数
    foldsMade: 0,     // 自分が降りた数
    oneEatsTen: false,
    queenWin: false,
    queenSlain: false,
  };
}

// reveal は MatchBoard に渡すのと同じ形:
//   { yourCard, opponentCard, youWonCard, youWonPot, folded, youFolded, yourLives, ... }
export function recordRound(s, reveal) {
  if (!s || !reveal) return s;
  s.rounds += 1;
  s.minLives = Math.min(s.minLives, reveal.yourLives ?? s.minLives);
  if (reveal.folded) {
    if (reveal.youFolded) s.foldsMade += 1;
    else s.foldsWon += 1;
  }
  // **見せ場は「自分が起こしたとき」だけ数える。** 相手のQueenにやられた局まで数えると、
  // 実績が「見た」の記録になって打ち手の証明にならない。
  const mine = reveal.yourCard, theirs = reveal.opponentCard;
  if (reveal.youWonCard) {
    if (isOne(mine) && isTen(theirs)) s.oneEatsTen = true;
    if (isQueen(mine)) s.queenWin = true;
    if (isOne(mine) && isQueen(theirs)) s.queenSlain = true;
  }
  return s;
}

// 試合終了時に1回だけ呼ぶ。履歴・報酬・実績・段位をまとめて確定させ、終了画面に出す物を返す。
//
// **ここが唯一の書き込み口。** 呼び出し元それぞれが addChips や setRankRp を直に呼ぶ形にすると、
// 「CPU練習でRPが動く」ような事故がいつか必ず混ざる（旧実装で実際に警戒していた箇所）。
export function finishMatch({ stats, ending, mode, online }) {
  const won = !!ending.youWon;
  const livesLeft = Math.max(0, ending.yourLives ?? 0);
  const reward = matchReward({ won, livesLeft });

  const entry = {
    mode, online,
    won, draw: !!ending.draw, reason: ending.reason,
    roundsPlayed: ending.roundsPlayed ?? stats.rounds,
    livesLeft, totalLives: stats.totalLives, minLives: stats.minLives,
    opponentLives: Math.max(0, ending.opponentLives ?? 0),
    suddenDeath: ending.reason === "suddenDeath",
    foldsWon: stats.foldsWon, foldsMade: stats.foldsMade,
    oneEatsTen: stats.oneEatsTen, queenWin: stats.queenWin, queenSlain: stats.queenSlain,
    reward,
  };
  addMatchHistory(entry);
  addChips(reward);

  // ボックスは**勝ってしか手に入らない**。完封は両方同時に成立する。
  //
  // **完封の判定は `isFlawlessWin`（storage.js）ただ1つ。ここに式を書き直さないこと**——実績「無傷」と
  // 同じ式を2箇所に書いていたため、「livesLeftは開始ライフを超える」ことを見落とした不具合が
  // 両方に同時に入り、**ノックアウトで勝てば毎回**完封ボックスが出ていた（経緯はあちらの注記）。
  // 勝利ボックスの方は、CPU練習でも同じものが出る以上ここだけ塞いでも意味が無いので触らない
  // （入手経路の分離＝「買えない」ことが要件であって、希少性そのものは要件ではない）。
  const flawless = isFlawlessWin(entry);
  const boxes = [];
  if (won) { addBox("victory"); boxes.push("victory"); }
  if (flawless) { addBox("flawless"); boxes.push("flawless"); }

  // 段位が動くのは**オンラインのランクマッチだけ**。カジュアルとCPU練習では一切動かさない。
  let rank = null;
  if (online && mode === "ranked" && !entry.draw) {
    const before = getRankRp();
    const res = applyRpDelta(before, won ? RP_PER_MATCH : -RP_PER_MATCH);
    setRankRp(res.totalRp);
    rank = { before, ...res, delta: won ? RP_PER_MATCH : -RP_PER_MATCH };
  }

  // 実績は履歴を書いた**後**に判定する（今の試合の結果を含めて数えるため）。
  const unlocked = checkAndUnlockAchievements();
  return { reward, boxes, rank, unlocked };
}
