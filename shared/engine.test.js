// shared/engine.js のユニットテスト。
// **ルールの核（誰が誰に勝つか）と、経済の不変条件だけを固定する。** CPUの閾値のような
// 「測って決める」値はここでは縛らない（tools/simulate.mjs の担当）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareCards, cardBand, announceBands, BAND, MIN_NUMBER, MAX_NUMBER, NUMBERS, UP_THRESHOLD,
  makeNumberCard, makeQueenCard, buildShoe, cardsDealtInMatch, COPIES_PER_RANK,
  raiseCost, raiseAmount, RAISE_FRACTIONS, normalizeRaiseFraction, wouldHaveWonPot,
  effectiveStack, mulberry32, MODES, ANTE, opponentCardDistribution,
} from "./engine.js";

const N = (n) => makeNumberCard(n);
const Q = () => makeQueenCard();

test("Ⅰだけが最上位を食う（Ⅹにも Queen にも勝つ）", () => {
  assert.equal(compareCards(N(1), N(10), false), "a");
  assert.equal(compareCards(N(10), N(1), true), "b");
  assert.equal(compareCards(N(1), Q(), false), "a");
  assert.equal(compareCards(Q(), N(1), true), "b");
});

test("Ⅰは最上位以外には全部負ける（最弱札であることが崩れていない）", () => {
  for (const n of NUMBERS) {
    if (n === 1 || n === MAX_NUMBER) continue;
    assert.equal(compareCards(N(1), N(n), false), "b", `Ⅰ が ${n} に勝ってしまっている`);
  }
});

test("Queenは Ⅰ 以外には無条件で勝つ", () => {
  for (const n of NUMBERS) {
    if (n === MIN_NUMBER) continue;
    assert.equal(compareCards(Q(), N(n), false), "a");
    assert.equal(compareCards(N(n), Q(), true), "b");
  }
});

test("同数字はチューザーが勝つ＝引き分けが構造的に存在しない", () => {
  for (const n of NUMBERS) {
    assert.equal(compareCards(N(n), N(n), true), "a");
    assert.equal(compareCards(N(n), N(n), false), "b");
  }
});

test("compareCardsは常に a か b を返す（総当たり）", () => {
  const all = [...NUMBERS.map(N), Q()];
  for (const x of all) for (const y of all) for (const ch of [true, false]) {
    assert.ok(["a", "b"].includes(compareCards(x, y, ch)));
  }
});

test("勝敗は非対称（同じ組で両方勝つ／両方負けるが起きない）", () => {
  const all = [...NUMBERS.map(N), Q()];
  for (const x of all) for (const y of all) {
    if (x.kind === "queen" && y.kind === "queen") continue; // Queenはシューに1枚しかない
    if (x.kind === "number" && y.kind === "number" && x.number === y.number) continue; // 同数字はチューザー依存
    // xから見た勝敗とyから見た勝敗が反対になっていること
    const fromX = compareCards(x, y, true);
    const fromY = compareCards(y, x, true);
    assert.notEqual(fromX === "a", fromY === "a");
  }
});

test("UP/DOWN: Ⅵ以上がUP、Ⅴ以下がDOWN、**QueenはDOWN**", () => {
  for (const n of NUMBERS) {
    assert.equal(cardBand(N(n)), n >= UP_THRESHOLD ? BAND.up : BAND.down);
  }
  // Queenが公表上DOWNであることは「DOWNが嘘つきの信号になる」設計の核。ここが反転したら
  // UPとDOWNの非対称が消え、読み合いの所在が変わる。
  assert.equal(cardBand(Q()), BAND.down);
});

test("DOWNには最強(Queen)と最上位を食う札(Ⅰ)の両方が含まれる", () => {
  const down = [...NUMBERS.map(N), Q()].filter((c) => cardBand(c) === BAND.down);
  assert.ok(down.some((c) => c.kind === "queen"));
  assert.ok(down.some((c) => c.number === MIN_NUMBER));
});

test("announceBandsは手札2枚の内訳を返す", () => {
  assert.deepEqual(announceBands([N(1), N(2)]), { up: 0, down: 2 });
  assert.deepEqual(announceBands([N(10), N(6)]), { up: 2, down: 0 });
  assert.deepEqual(announceBands([N(10), Q()]), { up: 1, down: 1 });
});

test("シュー: プールの半分を残し、Queenはちょうど1枚", () => {
  const rng = mulberry32(7);
  for (const rounds of [8, 15]) {
    const shoe = buildShoe(rounds, rng);
    const queens = shoe.filter((c) => c.kind === "queen");
    assert.equal(queens.length, 1, "Queenは必ず1枚だけ");
    assert.equal(shoe.length, (NUMBERS.length * COPIES_PER_RANK) / 2 + 1);
    // 配られる範囲より手前に入っていること（後ろに入ると絶対に出てこない）
    assert.ok(shoe.indexOf(queens[0]) < cardsDealtInMatch(rounds));
  }
});

test("シューは1試合ぶんの配札に足りる（枯渇しない）", () => {
  const rng = mulberry32(3);
  for (const m of Object.values(MODES)) {
    assert.ok(buildShoe(m.rounds, rng).length >= cardsDealtInMatch(m.rounds));
  }
});

test("配られる枚数は 4 + 2×(ラウンド-1)", () => {
  assert.equal(cardsDealtInMatch(1), 4);
  assert.equal(cardsDealtInMatch(8), 18);
  assert.equal(cardsDealtInMatch(15), 32);
});

test("raiseCostは不足分(owed)を埋めてから上乗せする", () => {
  // これが崩れると「コールするより、もう一段レイズし返す方が常に得」という一方向の歪みが出る
  // （旧cardEngineで実際に起きていた不具合。非フォールド試合の26.9%で拠出が不一致だった）。
  const r = raiseCost(8, 3, RAISE_FRACTIONS.half);
  assert.equal(r.owed, 3);
  assert.equal(r.amt, 4);
  assert.equal(r.total, 7);
});

test("上乗せ幅は owed を足す前のポットから決める", () => {
  // ポットリミット式（コール後のポット基準）にすると、ボタンの「1ポット」表記と実額が食い違う。
  assert.equal(raiseCost(10, 6, RAISE_FRACTIONS.pot).amt, raiseAmount(10, RAISE_FRACTIONS.pot));
});

test("レイズ額は常に1ライフ以上の整数", () => {
  for (let pot = 0; pot <= 40; pot++) {
    for (const f of Object.values(RAISE_FRACTIONS)) {
      const amt = raiseAmount(pot, f);
      assert.ok(Number.isInteger(amt) && amt >= 1, `pot=${pot} f=${f} amt=${amt}`);
    }
  }
});

test("レイズの応酬は必ず両者の拠出が一致して終わる", () => {
  // シミュレータが常設で検証している不変条件を、決定的な系列でも固定しておく。
  for (const seq of [["half"], ["pot"], ["half", "half"], ["pot", "half", "pot"], ["half", "pot", "half", "pot"]]) {
    const contrib = { a: ANTE, b: ANTE };
    let turn = "a";
    for (const key of seq) {
      const me = turn, you = me === "a" ? "b" : "a";
      const owed = contrib[you] - contrib[me];
      contrib[me] += raiseCost(contrib.a + contrib.b, owed, RAISE_FRACTIONS[key]).total;
      turn = you;
    }
    // 最後は必ずコール（不足分を埋める）で閉じる
    const me = turn, you = me === "a" ? "b" : "a";
    contrib[me] += contrib[you] - contrib[me];
    assert.equal(contrib.a, contrib.b, `系列 ${seq.join(">")} で拠出が揃わない`);
  }
});

test("normalizeRaiseFractionは未知の入力を既定へ倒す（信頼できない入力の防御）", () => {
  assert.equal(normalizeRaiseFraction(0.5), 0.5);
  assert.equal(normalizeRaiseFraction(1), 1);
  assert.equal(normalizeRaiseFraction(0.99), RAISE_FRACTIONS.half);
  assert.equal(normalizeRaiseFraction("なにか"), RAISE_FRACTIONS.half);
  assert.equal(normalizeRaiseFraction(undefined), RAISE_FRACTIONS.half);
});

test("wouldHaveWonPotはJOKERで反転する", () => {
  assert.equal(wouldHaveWonPot("king", true), true);
  assert.equal(wouldHaveWonPot("king", false), false);
  assert.equal(wouldHaveWonPot("joker", true), false);
  assert.equal(wouldHaveWonPot("joker", false), true);
});

test("effectiveStackは少ない方に揃う（サイドポットを作らない）", () => {
  assert.equal(effectiveStack(7, 3), 3);
  assert.equal(effectiveStack(2, 9), 2);
});

test("相手の札の分布は確率の合計が1で、公表と矛盾しない", () => {
  for (const bands of [{ up: 2, down: 0 }, { up: 1, down: 1 }, { up: 0, down: 2 }]) {
    for (const kj of ["king", "joker"]) {
      const dist = opponentCardDistribution(bands, kj);
      const sum = dist.reduce((s, d) => s + d.p, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `合計が1でない: ${sum}`);
      // UP-UPならDOWNの札の確率は0、DOWN-DOWNならUPの札の確率は0でなければならない。
      for (const d of dist) {
        const band = cardBand(d.card);
        if (bands.up === 2) assert.ok(band === BAND.up || d.p === 0);
        if (bands.up === 0) assert.ok(band === BAND.down || d.p === 0);
      }
    }
  }
});
