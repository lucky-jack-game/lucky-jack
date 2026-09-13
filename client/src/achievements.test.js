// 実績の**解放と告知の分離**（storage.jsのcheckAndUnlockAchievements）のユニットテスト。
//
// 個々の判定式そのものは client/src/battle/matchStats.test.js が、集計側の入力と一緒に固定する
// （「どう数えるか」と「どこで解放するか」を離して書くと、片方だけ直して食い違う）。
// ここが見るのは配管の方だけ:
//   ・解放した瞬間が告知できる場面とは限らない（試合中に直接解放されるものがある）ので、
//     未告知リストへ積んで終了画面でまとめて吐き出す
//   ・旧バージョンからの移行で、既に解放済みのものを一斉に蒸し返さない
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

const {
  ACHIEVEMENTS, unlockAchievement, checkAndUnlockAchievements,
  getUnlockedAchievements, addMatchHistory, resetAllData,
} = await import("./storage.js");

// 対戦履歴1件のひな形（1試合＝1エントリ。形は battle/matchStats.js が組み立てる）。
const entry = (over = {}) => ({
  mode: "casual", online: false, won: false, draw: false, reason: "knockout",
  roundsPlayed: 6, livesLeft: 0, totalLives: 6, minLives: 0, opponentLives: 6,
  suddenDeath: false, foldsWon: 0, foldsMade: 0,
  oneEatsTen: false, queenWin: false, queenSlain: false, reward: 10,
  ...over,
});

describe("実績の定義そのもの", () => {
  test("idが重複していない（重複すると片方が永久に解放されない）", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test("すべての実績が title と desc を持つ", () => {
    // descは未解放の実績で名前の代わりに出す唯一の手掛かり（称号一覧で伏せ字だけにしないため）。
    for (const a of ACHIEVEMENTS) {
      assert.ok(a.title && a.title.length > 0, `${a.id} に title が無い`);
      assert.ok(a.desc && a.desc.length > 0, `${a.id} に desc が無い`);
      assert.strictEqual(typeof a.check, "function", `${a.id} に check が無い`);
    }
  });

  test("空の履歴で落ちる判定式が無い（初回起動で必ず全件が評価される）", () => {
    for (const a of ACHIEVEMENTS) {
      assert.doesNotThrow(() => a.check([]), `${a.id} が空の履歴で例外を投げた`);
    }
  });

  test("フィールドが欠けた履歴でも落ちない", () => {
    // 仕様変更前に保存された履歴が残っていても、判定で例外を投げてはいけない
    // （1件でも投げると、そのプレイヤーは以後すべての実績が解放されなくなる）。
    for (const a of ACHIEVEMENTS) {
      assert.doesNotThrow(() => a.check([{ mode: "casual" }]), `${a.id} が古い履歴で例外を投げた`);
    }
  });
});

describe("checkAndUnlockAchievements（解放と告知の分離）", () => {
  beforeEach(() => resetAllData());

  test("履歴由来の解放を返す", () => {
    addMatchHistory(entry());
    const ids = checkAndUnlockAchievements().map((a) => a.id);
    assert.ok(ids.includes("first_match"));
    assert.ok(getUnlockedAchievements().includes("first_match"));
  });

  test("同じ状態で2回呼んでも2回目は空（告知が重複しない）", () => {
    addMatchHistory(entry());
    assert.ok(checkAndUnlockAchievements().length > 0);
    assert.deepStrictEqual(checkAndUnlockAchievements(), []);
  });

  test("直接解放したものも次の集計で必ず告知される", () => {
    assert.strictEqual(unlockAchievement("queen_win"), true);
    const ids = checkAndUnlockAchievements().map((a) => a.id);
    assert.ok(ids.includes("queen_win"), "直接解放した実績が告知されなかった");
  });

  test("二重解放はfalseを返し、告知も1回だけ", () => {
    assert.strictEqual(unlockAchievement("queen_win"), true);
    assert.strictEqual(unlockAchievement("queen_win"), false);
    assert.strictEqual(checkAndUnlockAchievements().length, 1);
  });

  test("この機能より前から解放済みのものを蒸し返さない", () => {
    addMatchHistory(entry());
    checkAndUnlockAchievements();            // 既存プレイヤー相当の状態を作る
    store.delete("lj_achievements_pending"); // 未告知リストだけが無い＝旧バージョンからの移行状態
    assert.deepStrictEqual(checkAndUnlockAchievements(), []);
  });
});

describe("ウォレット（単一通貨CHIP）", () => {
  beforeEach(() => resetAllData());

  test("0未満にはならない（賭けに連動しないので借金という概念が無い）", async () => {
    const { addChips, getChips } = await import("./storage.js");
    addChips(30);
    addChips(-100);
    assert.strictEqual(getChips(), 0);
  });

  test("旧GEM残高は1度だけ繰り越され、2度目は増えない", async () => {
    const { migrateLegacyWallet, getChips } = await import("./storage.js");
    store.set("lj_gems", "120");
    migrateLegacyWallet();
    assert.strictEqual(getChips(), 120);
    migrateLegacyWallet();
    assert.strictEqual(getChips(), 120);
  });
});

describe("初回の持参金", () => {
  beforeEach(() => resetAllData());

  test("1度だけ渡され、2度目は0を返して残高も変わらない", async () => {
    const { grantWelcomeChips, getChips, WELCOME_CHIPS } = await import("./storage.js");
    assert.strictEqual(grantWelcomeChips(), WELCOME_CHIPS);
    assert.strictEqual(getChips(), WELCOME_CHIPS);
    assert.strictEqual(grantWelcomeChips(), 0);
    assert.strictEqual(getChips(), WELCOME_CHIPS);
  });

  test("最安のスキンには届き、エピックには届かない", async () => {
    // **審査員が触るのは1〜2試合**（1試合10〜44 CHIP）なので、0から始めるとショップは
    // 最後まで一度も使えない部屋になる。一方で全部買えてしまうと、その後の対戦で得る
    // CHIPが何の意味も持たなくなる。SHOP_PRICE(common 80 / rare 220 / epic 460)に対して
    // 「レア1つ買っておつり」の線に置く。
    const { WELCOME_CHIPS } = await import("./storage.js");
    assert.ok(WELCOME_CHIPS >= 220, "レア1つに届かない額では輪が回らない");
    assert.ok(WELCOME_CHIPS < 460, "エピックまで届くと対戦の報酬が意味を失う");
  });
});

// ─── デイリーログインの「今日」はローカル日付 ───
// UTCで数えると、日本(UTC+9)では日付の変わり目が朝9時になる——同じ日の朝と昼に開くと
// ボーナスが2回出て、深夜0時をまたいでも翌朝9時までは新しい日にならない。
describe("デイリーログイン", () => {
  beforeEach(() => { store.clear(); });

  test("同じ日に何度開いても新しい日にならない（UTCで数えない）", async () => {
    const { checkDailyLogin } = await import("./storage.js");
    const RealDate = Date;
    // 時計を固定する。**クラスで包まないこと**（constructorから値を返す形になり、
    // super()を呼ばない実装として静的解析に引っかかる）。素の関数で足りる。
    const at = (iso) => {
      const fixed = new RealDate(iso);
      function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(fixed); }
      FakeDate.prototype = RealDate.prototype;
      FakeDate.now = () => fixed.getTime();
      globalThis.Date = FakeDate;
    };
    try {
      // ローカル時刻の朝と昼。UTC基準だと日付をまたぐ組み合わせになる時間帯を選ぶ。
      const day = new RealDate();
      day.setHours(8, 0, 0, 0);
      at(day.toISOString());
      const first = checkDailyLogin();
      assert.strictEqual(first.isNewDay, true);
      assert.strictEqual(first.loginDays, 1);

      const later = new RealDate(day);
      later.setHours(23, 0, 0, 0);
      at(later.toISOString());
      const second = checkDailyLogin();
      assert.strictEqual(second.isNewDay, false, "同じ日なのに2度目のボーナスが出た");
      assert.strictEqual(second.loginDays, 1);

      // 翌日は進む。
      const tomorrow = new RealDate(day);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(1, 0, 0, 0);
      at(tomorrow.toISOString());
      const third = checkDailyLogin();
      assert.strictEqual(third.isNewDay, true, "日付が変わったのに新しい日にならない");
      assert.strictEqual(third.loginDays, 2);
    } finally {
      globalThis.Date = RealDate;
    }
  });
});
