// 段位RPの境界の扱い（オンライン対戦のみ）。applyRpDeltaは「底」と「降格時の着地点」という
// 2つの規則を1箇所に閉じるための関数なので、その2つをここで固定する。
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyRpDelta, resolveRank, rankIndex, RANK_TIERS, hasReachedTier,
  RP_PER_TIER, RP_PER_MATCH, RP_DEMOTION_LANDING,
} from "./rank.js";

const tierId = (rp) => resolveRank(rp).tier.id;

describe("resolveRank", () => {
  test("0 RPはSTONE", () => {
    assert.equal(tierId(0), "stone");
    assert.equal(resolveRank(0).rpInTier, 0);
  });

  test("段位は100RPごとに上がる", () => {
    assert.equal(tierId(RP_PER_TIER - 1), "stone");
    assert.equal(tierId(RP_PER_TIER), "iron");
    assert.equal(tierId(RP_PER_TIER * 2), "bronze");
  });

  test("MONARCHはRPでは到達できない（席数制のためDIAMONDで頭打ち）", () => {
    const diamondIndex = RANK_TIERS.findIndex((t) => t.id === "diamond");
    assert.equal(tierId(diamondIndex * RP_PER_TIER), "diamond");
    // DIAMONDの上限を大きく超えてもMONARCHにはならない
    assert.equal(tierId(diamondIndex * RP_PER_TIER + 9999), "diamond");
    assert.equal(resolveRank(diamondIndex * RP_PER_TIER + 40).isMax, true);
  });

  test("負のRPを渡してもSTONE 0に丸める（負の数は一度も画面に出さない）", () => {
    assert.equal(tierId(-500), "stone");
    assert.equal(resolveRank(-500).rpInTier, 0);
  });
});

describe("applyRpDelta", () => {
  test("勝てば+RP_PER_MATCH、負ければ-RP_PER_MATCH", () => {
    // 段位の境界をまたがない段の中ほどで測る（境界をまたぐと降格の着地点が働くのが正しい挙動）
    assert.equal(applyRpDelta(250, RP_PER_MATCH).totalRp, 250 + RP_PER_MATCH);
    assert.equal(applyRpDelta(250, -RP_PER_MATCH).totalRp, 250 - RP_PER_MATCH);
  });

  test("STONE 0 が底。負けても負の数にならない", () => {
    const r = applyRpDelta(0, -RP_PER_MATCH);
    assert.equal(r.totalRp, 0);
    assert.equal(r.rank.tier.id, "stone");
    assert.equal(r.demoted, false); // 底で止まっただけで降格ではない
  });

  test("底の手前から落ちても0で止まる", () => {
    assert.equal(applyRpDelta(10, -RP_PER_MATCH).totalRp, 0);
  });

  test("昇格には緩衝を置かない（自然な加算のまま）", () => {
    // IRONの手前(90) から +20 → 110 = BRONZEではなくIRONの10
    const r = applyRpDelta(RP_PER_TIER - 10, RP_PER_MATCH);
    assert.equal(r.totalRp, RP_PER_TIER + 10);
    assert.equal(r.promoted, true);
    assert.equal(r.tierBefore.id, "stone");
    assert.equal(r.tierAfter.id, "iron");
  });

  test("降格するとRP_DEMOTION_LANDINGに着地する（境界での往復を防ぐ）", () => {
    // GOLD 0RP(=400) から負けると、自然な引き算では SILVER 80 になるところを 75 に落とす
    const goldIndex = rankIndex(RANK_TIERS.find((t) => t.id === "gold"));
    const r = applyRpDelta(goldIndex * RP_PER_TIER, -RP_PER_MATCH);
    assert.equal(r.demoted, true);
    assert.equal(r.tierAfter.id, "silver");
    assert.equal(r.rank.rpInTier, RP_DEMOTION_LANDING);
    // 着地点が自然な引き算(80)より低い＝復帰に1勝では足りない、が着地点を置く目的
    assert.ok(RP_DEMOTION_LANDING < RP_PER_TIER - RP_PER_MATCH);
  });

  test("降格直後の1勝では復帰できない（着地点を置いた目的そのもの）", () => {
    const goldIndex = rankIndex(RANK_TIERS.find((t) => t.id === "gold"));
    const dropped = applyRpDelta(goldIndex * RP_PER_TIER, -RP_PER_MATCH);
    const back = applyRpDelta(dropped.totalRp, RP_PER_MATCH);
    assert.equal(back.tierAfter.id, "silver");
    assert.equal(back.promoted, false);
    // 2勝すれば戻れる
    assert.equal(applyRpDelta(back.totalRp, RP_PER_MATCH).tierAfter.id, "gold");
  });

  test("段位をまたがない増減では昇降格フラグが立たない", () => {
    const r = applyRpDelta(250, RP_PER_MATCH);
    assert.equal(r.promoted, false);
    assert.equal(r.demoted, false);
  });
});

describe("rankIndex", () => {
  test("段位の序列を返す", () => {
    assert.ok(rankIndex(RANK_TIERS[0]) < rankIndex(RANK_TIERS[3]));
  });
  test("刻みは盾に収まる4本が上限", () => {
    for (const t of RANK_TIERS) assert.ok(t.marks >= 1 && t.marks <= 4, `${t.id} marks=${t.marks}`);
  });
});

// 段位由来の実績（storage.jsのACHIEVEMENTS）が使う判定。実績は取り消さない前提なので、
// 「今その段位か」ではなく「その段位以上か」でなければならない。
describe("hasReachedTier", () => {
  test("ちょうど到達したRPでtrue", () => {
    assert.equal(hasReachedTier(2 * RP_PER_TIER, "bronze"), true);
    assert.equal(hasReachedTier(2 * RP_PER_TIER - 1, "bronze"), false);
  });

  test("上位段位のプレイヤーは下位段位の条件も満たす", () => {
    const diamondRp = rankIndex(RANK_TIERS.find((t) => t.id === "diamond")) * RP_PER_TIER;
    assert.equal(hasReachedTier(diamondRp, "bronze"), true);
    assert.equal(hasReachedTier(diamondRp, "gold"), true);
    assert.equal(hasReachedTier(diamondRp, "diamond"), true);
  });

  test("MONARCHはRPでは到達できない（席数制のため必ずfalse）", () => {
    assert.equal(hasReachedTier(99999, "monarch"), false);
  });

  test("未知の段位IDはfalse", () => {
    assert.equal(hasReachedTier(99999, "mythic"), false);
  });

  test("0 RP・負値でもSTONE扱いで落ちない", () => {
    assert.equal(hasReachedTier(0, "stone"), true);
    assert.equal(hasReachedTier(-500, "bronze"), false);
  });
});
