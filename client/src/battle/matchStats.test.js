// 集計（実績の入力そのもの）の単体テスト。
//
// **実績は壊れても画面に何も出ない。** 「達成したのに解放されない」も「達成していないのに
// 解放される」も、どちらも静かに起きる——旧実装で連勝系が両モードとも壊れていて、しかも
// 壊れ方が逆だったのに長く気付けなかったのはそのため。数え方はここで固定しておく。
//
// storage.js は module scope で localStorage を触らないので、node からそのまま import できる
// （finishMatch だけは書き込むのでここでは呼ばない）。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStats, recordRound } from "./matchStats.js";
import { matchReward, MATCH_REWARD, ACHIEVEMENTS } from "../storage.js";

const num = (n) => ({ kind: "number", number: n });
const queen = () => ({ kind: "queen", number: null });
const round = (o) => ({ folded: false, youFolded: false, youWonCard: false, yourLives: 6, ...o });

describe("集計", () => {
  test("minLives は途中の最小値を覚える（終了時のライフでは逆転を測れない）", () => {
    const s = createStats(6);
    recordRound(s, round({ yourLives: 4 }));
    recordRound(s, round({ yourLives: 1 }));
    recordRound(s, round({ yourLives: 5 }));
    assert.equal(s.minLives, 1);
    assert.equal(s.rounds, 3);
  });

  test("降りた側を取り違えない", () => {
    const s = createStats(6);
    recordRound(s, round({ folded: true, youFolded: true }));
    recordRound(s, round({ folded: true, youFolded: false }));
    recordRound(s, round({ folded: true, youFolded: false }));
    assert.equal(s.foldsMade, 1);
    assert.equal(s.foldsWon, 2);
  });

  test("見せ場は自分が起こした時だけ数える（やられた局は数えない）", () => {
    const s = createStats(6);
    // 相手の Queen にやられた局
    recordRound(s, round({ youWonCard: false, yourCard: num(3), opponentCard: queen() }));
    // 相手の Ⅰ に Ⅹ を食われた局
    recordRound(s, round({ youWonCard: false, yourCard: num(10), opponentCard: num(1) }));
    assert.equal(s.queenWin, false);
    assert.equal(s.oneEatsTen, false);

    recordRound(s, round({ youWonCard: true, yourCard: num(1), opponentCard: num(10) }));
    recordRound(s, round({ youWonCard: true, yourCard: queen(), opponentCard: num(9) }));
    recordRound(s, round({ youWonCard: true, yourCard: num(1), opponentCard: queen() }));
    assert.equal(s.oneEatsTen, true);
    assert.equal(s.queenWin, true);
    assert.equal(s.queenSlain, true);
  });

  test("Ⅰ で Ⅹ に勝っても、それが Queen 相手なら oneEatsTen にしない", () => {
    const s = createStats(6);
    recordRound(s, round({ youWonCard: true, yourCard: num(1), opponentCard: queen() }));
    assert.equal(s.oneEatsTen, false);
    assert.equal(s.queenSlain, true);
  });
});

describe("報酬", () => {
  test("負けても base は必ず出る", () => {
    assert.equal(matchReward({ won: false, livesLeft: 0 }), MATCH_REWARD.base);
  });
  test("勝ちと残ライフが上乗せされる", () => {
    assert.equal(
      matchReward({ won: true, livesLeft: 4 }),
      MATCH_REWARD.base + MATCH_REWARD.win + 4 * MATCH_REWARD.perLifeLeft,
    );
  });
  test("残ライフが負でも報酬は減らない", () => {
    assert.equal(matchReward({ won: false, livesLeft: -3 }), MATCH_REWARD.base);
  });
});

describe("実績の条件は、この集計から実際に判定できる", () => {
  // 履歴1件を作り、各実績の check がそれを拾えることを確かめる。
  // **ここが通らない実績は「誰も取れない実績」**で、画面には何も出ないので気付けない。
  const entry = {
    won: true, draw: false, online: true, mode: "ranked",
    roundsPlayed: 7, livesLeft: 7, totalLives: 7, minLives: 2,
    reason: "knockout", suddenDeath: true, foldsWon: 3, foldsMade: 1,
    oneEatsTen: true, queenWin: true, queenSlain: true,
  };
  const byId = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
  // flawless はこの entry では成立しない（minLives 2 ＝ ライフを失っている）。
  // 「1つも失わずに勝つ」と「崖まで落ちてから勝つ」は同じ試合では両立しないので、下で別に見る。
  const historyOnly = ["first_match", "first_win", "one_eats_ten", "queen_win", "queen_slain",
    "comeback", "reader", "iron_nerve"];

  for (const id of historyOnly) {
    test(id, () => {
      assert.ok(byId[id], `${id} が ACHIEVEMENTS に無い`);
      assert.equal(byId[id].check([entry]), true);
    });
  }

  test("comeback は崖(totalLives/3未満)まで落ちていないと解放されない", () => {
    assert.equal(byId.comeback.check([{ ...entry, minLives: 5 }]), false);
  });

  // 一度もライフを失わずに勝った試合。ノックアウトなので **livesLeft は開始ライフを超える**
  // （相手のぶんも手元に来る）——完封の判定にこの値を使えないのはそのため。
  const untouched = { ...entry, minLives: entry.totalLives, livesLeft: entry.totalLives * 2 };

  test("flawless はライフを1つも失っていないときだけ解放される", () => {
    assert.equal(byId.flawless.check([untouched]), true);
    assert.equal(byId.flawless.check([{ ...untouched, minLives: entry.totalLives - 1 }]), false);
  });

  test("ノックアウトで勝っただけでは flawless にならない", () => {
    // 実際に起きていた回帰: livesLeft >= totalLives で
    // 判定していたため、相手のライフを取り切った時点で必ず真になり、**勝てばほぼ毎回**成立していた。
    // 実測のノックアウト率はカジュアル65.4%・ランク78.3%。
    assert.equal(byId.flawless.check([{ ...entry, livesLeft: entry.totalLives * 2, minLives: 2 }]), false);
  });

  test("相手の切断による勝ちは flawless に数えない（開始直後の切断が最高難度になってしまう）", () => {
    // forfeit は残った側のライフを一切削らないので、素直に判定すると 2タブ開いて片方を
    // 落とすだけで無限に出せる。報酬ボックス側(matchStats.js の finishMatch)も同じ判定を通る。
    assert.equal(byId.flawless.check([{ ...untouched, reason: "forfeit" }]), false);
    assert.equal(byId.flawless.check([{ ...untouched, reason: "knockout" }]), true);
  });

  test("「1試合でN回」系の閾値が、1試合の局数(中央値5〜7)を超えていない", () => {
    // 超えると事実上到達不能になる。reader の3回は7局の試合なら十分起こりうる。
    assert.equal(byId.reader.check([{ ...entry, foldsWon: 2 }]), false);
    assert.equal(byId.reader.check([{ ...entry, foldsWon: 3 }]), true);
  });
});
