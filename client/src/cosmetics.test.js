// 報酬ボックスの在庫と抽選（cosmetics.js）のユニットテスト。
//
// **抽選の失敗は画面に何も出さない。** 当たりが出ないことと、運が悪いことは見分けが付かない
// ——実際に `BOX_POOLS` の鍵が旧トーナメント仕様の champion/grandSlam のまま残り、限定品9点が
// 1つも出ない状態が放置されていた（cosmetics.js の冒頭参照）。ここが唯一の検知手段になる。
//
// storage.jsはlocalStorageを直接触るが、read/writeがtry/catchで包まれているためNode上でも
// import自体は通る。念のためスタブも置く（**storage.jsのimportより前**に置く必要があるため、
// 実体は下の動的importで読む——ESMの静的importは巻き上げられて間に合わない）。
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { BOX_TYPES, getChips, matchReward } = await import("./storage.js");
const {
  BOX_POOLS, SHOP_STOCK, BOX_DUPLICATE_CHIP_AWARD, COSMETIC_OWNERSHIP,
  boxPool, rollBoxReward,
} = await import("./cosmetics.js");

const own = (it) => COSMETIC_OWNERSHIP[it.type].grant(it.refId);
const isOwned = (it) => COSMETIC_OWNERSHIP[it.type].isOwned(it.refId);
// ライフはゼロサムなので勝者は相手のぶんも持っている（storage.js の matchReward 参照）。
// カジュアルの完勝がいちばん高く、これが1試合で得られるCHIPの上限。
const MAX_MATCH_REWARD = matchReward({ won: true, livesLeft: 12 });

beforeEach(() => { store.clear(); });

describe("在庫表そのもの", () => {
  test("すべてのボックスに中身がある（鍵が BOX_TYPES と一致している）", () => {
    // これが今回の回帰そのもの。addBox が積む鍵でプールを引けなければ、そのボックスは何も出さない。
    for (const type of Object.keys(BOX_TYPES)) {
      assert.ok(boxPool(type), `BOX_POOLS["${type}"] が無い——このボックスは何も出さない`);
    }
  });

  test("プールに無い鍵は null を返す（旧トーナメント仕様の鍵で引いても当たらない）", () => {
    assert.strictEqual(boxPool("champion"), null);
    assert.strictEqual(rollBoxReward("champion"), null);
  });

  test("ボックス限定品はショップに1点も並ばない", () => {
    // 「買えない」ことがボックスの唯一の価値なので、CHIPで買える経路が1本でもあると意味が消える。
    const shopIds = new Set(SHOP_STOCK.map((it) => it.id));
    for (const pool of Object.values(BOX_POOLS)) {
      for (const it of pool) assert.ok(!shopIds.has(it.id), `${it.id} がショップにも並んでいる`);
    }
  });

  test("同じ品が2つのボックスに入っていない", () => {
    const seen = new Set();
    for (const pool of Object.values(BOX_POOLS)) {
      for (const it of pool) {
        assert.ok(!seen.has(it.id), `${it.id} が複数のボックスに入っている`);
        seen.add(it.id);
      }
    }
  });

  test("かぶりのCHIPは1試合の報酬の上限を超えない", () => {
    // 勝利ボックスは**勝てば毎回**出る。ここが1試合の報酬を超えると、集め終えた後は
    // 「かぶりが主収入」になってショップの価格が勝手に安くなる。
    for (const [rarity, award] of Object.entries(BOX_DUPLICATE_CHIP_AWARD)) {
      assert.ok(award > 0, `${rarity} の代償が0——開封が完全な空振りになる`);
      assert.ok(award <= MAX_MATCH_REWARD, `${rarity} の代償 ${award} が1試合の上限 ${MAX_MATCH_REWARD} を超えている`);
    }
  });

  test("すべての品のレア度にかぶり時の代償が定義されている", () => {
    for (const pool of Object.values(BOX_POOLS)) {
      for (const it of pool) assert.ok(BOX_DUPLICATE_CHIP_AWARD[it.rarity] > 0, `${it.id} (${it.rarity})`);
    }
  });
});

describe("開封の抽選", () => {
  test("未所持のものが出て、その場で付与される", () => {
    const got = rollBoxReward("victory", () => 0);
    assert.ok(got && !got.duplicate);
    assert.ok(isOwned(got), "出たのに付与されていない");
  });

  test("一部だけ所持済みのときは、残っている未所持からしか出ない", () => {
    // ここが「かぶり」の本体。**全部揃うまでかぶりは起きない**ことを固定する。
    const pool = boxPool("victory");
    const last = pool[pool.length - 1];
    for (const it of pool.slice(0, -1)) own(it);
    // randを振り切っても、残り1点しか候補が無いので必ずそれが出る。
    for (const r of [0, 0.49, 0.99]) {
      store.clear();
      for (const it of pool.slice(0, -1)) own(it);
      const got = rollBoxReward("victory", () => r);
      assert.strictEqual(got.id, last.id);
      assert.ok(!got.duplicate);
    }
  });

  test("全て所持済みならCHIPに変わる（空振りにはしない）", () => {
    const pool = boxPool("flawless");
    for (const it of pool) own(it);
    const before = getChips();
    const got = rollBoxReward("flawless", () => 0);
    assert.strictEqual(got.duplicate, true);
    assert.strictEqual(got.chipAward, BOX_DUPLICATE_CHIP_AWARD[got.rarity]);
    assert.strictEqual(getChips(), before + got.chipAward);
  });

  test("どのボックスも、開け続ければ中身を全部出せる", () => {
    // 「出ない品」が1つでもあると、集める動機そのものが嘘になる。
    for (const type of Object.keys(BOX_TYPES)) {
      store.clear();
      const pool = boxPool(type);
      for (let i = 0; i < pool.length; i++) rollBoxReward(type, () => 0);
      for (const it of pool) assert.ok(isOwned(it), `${type}: ${it.id} が出ない`);
    }
  });
});
