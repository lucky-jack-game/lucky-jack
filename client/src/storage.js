// localStorage の薄いラッパー。サーバー側にDB永続化がない(意図的なスコープ外)ため、
// 対戦履歴・実績・ショップ/スキン所持状況・各種設定はすべてここを経由してクライアント側に保存する。
import { hasReachedTier } from "./rank.js";
import { ONLINE_ENABLED } from "./features.js";

const PREFIX = "lj_";
const KEYS = {
  matchHistory: PREFIX + "match_history",
  achievements: PREFIX + "achievements",
  achievementsPending: PREFIX + "achievements_pending", // 解放済みだがまだ告知していないID（下記checkAndUnlockAchievements参照）
  chips: PREFIX + "chips",            // 唯一の通貨（CHIP）。対戦して稼ぎ、ショップで使う
  legacyGems: PREFIX + "gems",        // 旧GEM。単一通貨化の際に1度だけCHIPへ繰り越して消す
  ownedSkins: PREFIX + "owned_skins",
  equippedSkin: PREFIX + "equipped_skin",
  ownedTables: PREFIX + "owned_tables",
  equippedTable: PREFIX + "equipped_table",
  ownedTitles: PREFIX + "owned_titles",
  equippedTitle: PREFIX + "equipped_title",
  settings: PREFIX + "settings",
  lastLogin: PREFIX + "last_login",
  loginDays: PREFIX + "login_days",
  shopSeed: PREFIX + "shop_seed",     // プレイヤーごとに異なる品揃えを作るための固定シード
  shopSold: PREFIX + "shop_sold",     // { epoch, ids[] } — 同じ入れ替え周期の間だけ売切れを覚えておく
  boxes: PREFIX + "boxes",            // 未開封ボックスの在庫 { [boxType]: 個数 }
  rankRp: PREFIX + "rank_rp",         // オンライン対戦の通算RP（段位。CPU練習では一切動かない）
  tutorialDone: PREFIX + "tutorial_done", // 初回チュートリアルを見終えた（またはスキップした）か
  welcomeGranted: PREFIX + "welcome_granted", // 初回の持参金を渡したか（1度だけ）
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 容量超過やプライベートモード等で書き込めない場合は黙って無視する（アプリの動作自体は継続できる）
  }
}

export const DEFAULT_SETTINGS = {
  bgmVolume: 70,
  seVolume: 100,
  reduceMotion: false,
  textScale: "normal", // "small" | "normal" | "large"
  haptics: true,
  // 全画面。**既定でON**——タイトル画面を押した1回のクリックに相乗りして入る（fullscreen.js）。
  // 入れない環境（iPhone Safari・iframe）では失敗して何も起きないだけなので、既定でも害は無い。
  fullscreen: true,
  // ─── キーボード操作（keybinds.js） ───
  // ベット行の各操作に割り当てるキー。既定は横1列のホームポジションだが、設定画面から
  // 自由に付け替えられる。KING/JOKERの選択と手札の選択は、並び順が画面に
  // 出ている物の順序そのものなので設定対象にせず A/D 固定。
  betKeys: { fold: "a", callCheck: "s", raiseHalf: "d", raisePot: "f" },
  foldGuard: "hold", // "hold" | "instant" | "off"
};

// ─── 対戦履歴（ランキング＝自己記録画面の生データ） ───
export function addMatchHistory(entry) {
  const list = read(KEYS.matchHistory, []);
  list.unshift({ ts: Date.now(), ...entry });
  write(KEYS.matchHistory, list.slice(0, 200));
}
export function getMatchHistory() {
  return read(KEYS.matchHistory, []);
}

// ─── 実績/称号 ───
export function getUnlockedAchievements() {
  return read(KEYS.achievements, []);
}
export function unlockAchievement(id) {
  const list = getUnlockedAchievements();
  if (list.includes(id)) return false;
  list.push(id);
  write(KEYS.achievements, list);
  // 解放した瞬間が必ずしも告知できる場面とは限らない（試合中に解放されるものがある）ので、
  // 未告知として積んでおき、試合終了画面でまとめて出す。詳細は下記のdrain参照。
  const pending = read(KEYS.achievementsPending, []);
  if (!pending.includes(id)) write(KEYS.achievementsPending, [...pending, id]);
  return true;
}
export function getEquippedTitle() {
  return read(KEYS.equippedTitle, null);
}
export function setEquippedTitle(id) {
  write(KEYS.equippedTitle, id);
}

// 実績の定義と達成条件。オンライン対戦・CPU練習のどちらも同じ対戦履歴(matchHistory)に
// 記録されるので、判定はここ1箇所だけに置く。
//
// **1試合＝1エントリ**（旧トーナメントは「4ラウンド×3試合」を1エントリにしていた）。
// エントリの形は client/src/battle/matchStats.js が組み立てる——実績の閾値を触るときは、
// そこで実際に何を数えているかを必ず確認すること。
//
// 閾値の決め方: **1試合の局数は中央値で5〜7局**（npm run sim の実測）。「1試合中にN回」系の
// 条件は、この局数を超える値を書くと誰も取れない実績になる。画面には何も出ないので気付けない。
export const ACHIEVEMENTS = [
  { id: "first_match", title: "初陣", desc: "はじめての対戦を終える", check: (h) => h.length >= 1 },
  { id: "first_win", title: "初勝利", desc: "対戦に勝利する", check: (h) => h.some((e) => e.won) },
  { id: "veteran", title: "常連", desc: "20回対戦する", check: (h) => h.length >= 20 },
  // ── このルールならではの見せ場 ──
  // どれも「一度でも起きたか」で判定する。頻度を条件にすると、Queenがシューに1枚しか
  // 入っていない以上どうしても運の比重が大きくなりすぎる。
  { id: "one_eats_ten", title: "下剋上の刃", desc: "Ⅰ で Ⅹ を食う", check: (h) => h.some((e) => e.oneEatsTen) },
  { id: "queen_win", title: "女王の一撃", desc: "Queen で局を制する", check: (h) => h.some((e) => e.queenWin) },
  { id: "queen_slain", title: "玉座を穿つ", desc: "Ⅰ で Queen を討ち取る", check: (h) => h.some((e) => e.queenSlain) },
  // ── 打ち方を測る ──
  // **切断勝ちは無傷に数えない**（forfeitは残った側のライフを一切削らないので、素直に判定すると
  // 「開始直後に相手が落ちた」が最高難度の実績になる）。報酬ボックス側も同じ条件で塞いである。
  // 判定は isFlawlessWin ただ1つ（下記）。**ここに式を展開し直さないこと**——完封ボックス側にも
  // 同じ式が書かれていたせいで、同じ不具合が2箇所に同時に入っていた。
  { id: "flawless", title: "無傷", desc: "ライフを1つも失わずに勝つ", check: (h) => h.some(isFlawlessWin) },
  // 「崖」の閾値は totalLives/3 未満（キャリア画面・シミュレータの逆転率と同じ定義）。
  // 固定値にするとモードによって意味が変わる（カジュアル6・ランク7）。
  { id: "comeback", title: "崖っぷち", desc: "残りライフが3分の1を切ってから勝つ", check: (h) => h.some((e) => e.won && e.minLives * 3 < e.totalLives) },
  { id: "reader", title: "読み師", desc: "1試合で3回、相手を降ろす", check: (h) => h.some((e) => (e.foldsWon || 0) >= 3) },
  { id: "iron_nerve", title: "鉄の胆力", desc: "サドンデスを制する", check: (h) => h.some((e) => e.won && e.suddenDeath) },
  // ── 段位到達（オンラインのランクマッチのみ）──
  // **称号は「対戦相手に自分の段位を見せる唯一の手段」でもある**（段位は通信に乗らず、
  // 対戦画面に出るのは名前の隣の称号バッジだけ）。checkは履歴ではなく通算RPを直接読む——
  // 昇格処理側にunlockAchievement()を足す形にすると、この機能より前から段位を持っている
  // プレイヤーは次に昇格するまで永久に解放されない。
  // online: true ＝オンラインを出さない版（features.js）では画面の一覧から外す（定義は残す）。
  { id: "rank_bronze", title: "ブロンズ級", desc: "ランクマッチで BRONZE に到達する", online: true, check: () => hasReachedTier(getRankRp(), "bronze") },
  { id: "rank_gold", title: "ゴールド級", desc: "ランクマッチで GOLD に到達する", online: true, check: () => hasReachedTier(getRankRp(), "gold") },
  { id: "rank_diamond", title: "ダイヤ級", desc: "ランクマッチで DIAMOND に到達する", online: true, check: () => hasReachedTier(getRankRp(), "diamond") },
];

// 画面に並べる実績。**オンラインを出さない版では段位の実績を外す**——取る手段が1つも無い実績が
// 一覧と母数に混ざると、「0 / 13」のうち3つは永遠に埋まらない。
export function visibleAchievements() {
  return ONLINE_ENABLED ? ACHIEVEMENTS : ACHIEVEMENTS.filter((a) => !a.online);
}

// 現在の対戦履歴に対して未解放の実績がないか判定し、**まだ告知していない解放分**を返す。
// 試合終了時（addMatchHistory直後）に呼ぶ想定の冪等な処理。
//
// 「checkの結果だけを返す」形だと、試合中に直接unlockAchievement()する一発イベント系が
// 一度も画面に出ないまま解放される——実際にそうなっていた。
// 解放と告知を分け、未告知リストを最後に必ず吐き出すことで、解放経路を問わず告知される。
export function checkAndUnlockAchievements() {
  const history = getMatchHistory();
  const already = getUnlockedAchievements();
  for (const a of ACHIEVEMENTS) {
    if (!already.includes(a.id) && a.check(history)) unlockAchievement(a.id);
  }
  const pending = read(KEYS.achievementsPending, []);
  if (pending.length === 0) return [];
  write(KEYS.achievementsPending, []);
  return pending.map((id) => ACHIEVEMENTS.find((a) => a.id === id)).filter(Boolean);
}

// ─── ショップ（ガチャの置き換え） ───
// ガチャは廃止し、スキンは「1時間ごとに入れ替わる、プレイヤーごとに違う品揃えのショップ」で買う。
// サーバー側にDB永続化が無い（意図的なスコープ外）ため、品揃えはサーバーが配るのではなく
// 「プレイヤー固有のシード × 時刻(1時間単位)」から決定論的に生成する。こうすると
//  ・同じ1時間の間は、リロードしても品揃えが変わらない（引き直しでガチャ化しない）
//  ・プレイヤーごとに違う品揃えになる
//  ・時刻をまたぐと自動で入れ替わる
// の3つが、通信もサーバー状態も無しに同時に成立する。
const SHOP_ROTATION_MS = 60 * 60 * 1000;

// このブラウザ固有のショップシード（初回アクセス時に1度だけ生成して以後固定）。
export function getShopSeed() {
  let seed = read(KEYS.shopSeed, null);
  if (typeof seed !== "number") {
    seed = Math.floor(Math.random() * 0xffffffff);
    write(KEYS.shopSeed, seed);
  }
  return seed;
}

// 現在の入れ替え周期の通し番号と、次の入れ替え時刻。
export function getShopEpoch() {
  return Math.floor(Date.now() / SHOP_ROTATION_MS);
}
export function getShopNextRotationTs() {
  return (getShopEpoch() + 1) * SHOP_ROTATION_MS;
}

// 売切れ表示は現在の周期の間だけ保持する（周期が変われば自動的に空になる）。
// 「所持済みかどうか」とは別に持つ理由: 称号/スキンの所持判定だけだと、購入直後に品揃えから
// 消えてしまい「今さっき買った」という手応えが残らないため、売切れとして棚に残す。
export function getShopSoldIds() {
  const rec = read(KEYS.shopSold, null);
  if (!rec || rec.epoch !== getShopEpoch()) return [];
  return Array.isArray(rec.ids) ? rec.ids : [];
}
export function markShopSold(id) {
  const ids = getShopSoldIds();
  if (!ids.includes(id)) ids.push(id);
  write(KEYS.shopSold, { epoch: getShopEpoch(), ids });
}

// ─── 報酬ボックス（ガチャの代替となる「引く」体験） ───
// **CHIPでは買えず、勝ってしか手に入らない。** 中身もショップには絶対に並ばない限定品にする
// （買って手に入るものと、勝って手に入るものを完全に分けるのが設計の要——CHIPで買える経路を
// 1本でも作った瞬間にボックスの意味が消える）。
export const BOX_TYPES = {
  victory: { label: "勝利ボックス", desc: "対戦に勝利して獲得" },
  // 完封は実際に難しい（相手のアンティを毎局取り切る必要がある）ので、限定品の中でも
  // いちばん出にくい経路になる。**両方同時に成立しうる**（完封勝ちなら2つとも渡す）。
  flawless: { label: "完封ボックス", desc: "ライフを1つも失わずに勝利して獲得" },
};
// ログイン日数を読むだけ（checkDailyLogin と違って日付を進めない）。ロビーの TODAY パネル用。
export function getLoginDays() {
  return read(KEYS.loginDays, 0);
}

export function getBoxes() {
  const raw = read(KEYS.boxes, {});
  const out = {};
  for (const t of Object.keys(BOX_TYPES)) out[t] = Math.max(0, Number(raw?.[t]) || 0);
  return out;
}
export function addBox(type, count = 1) {
  if (!BOX_TYPES[type]) return getBoxes();
  const boxes = getBoxes();
  boxes[type] += Math.max(0, count);
  write(KEYS.boxes, boxes);
  return boxes;
}
// 1個消費する。在庫が無ければfalseを返す（開封処理は必ずこの戻り値を見てから中身を渡すこと）。
export function consumeBox(type) {
  const boxes = getBoxes();
  if (!boxes[type] || boxes[type] <= 0) return false;
  boxes[type] -= 1;
  write(KEYS.boxes, boxes);
  return true;
}


// ─── 段位RP（オンライン対戦のみ） ───
// **CPU練習モードからは絶対に呼ばないこと**（段位はオンライン対戦だけのシステム）。
// 増減の単位は**1試合につき**±RP_PER_MATCH(20)の固定。ランク差による補正は行わない。
// **動くのはランクマッチだけ**（カジュアルとCPU練習では一切動かない）。オンラインをCPUで
// 埋めなくなったので、旧仕様にあった「CPU相手でもRPが動く／段位に応じてCPUを強くする」という
// farm抑止の仕組みは前提ごと不要になった。
// 境界の扱い（STONE 0が底・降格時の着地点）は rank.js の applyRpDelta に閉じてあるので、
// ここでRPを直接足し引きしないこと。
export function getRankRp() {
  return Math.max(0, read(KEYS.rankRp, 0) | 0);
}
export function setRankRp(totalRp) {
  const v = Math.max(0, totalRp | 0);
  write(KEYS.rankRp, v);
  return v;
}

// ─── 初回チュートリアル ───
// 「見た」ことだけを持つ（どこまで進んだかは持たない）。途中で閉じても最後まで見ても同じ扱いにする
// ——再開位置を覚えると、閉じた人に毎回同じ画面を出し直すことになり、かえって邪魔になるため。
export function isTutorialDone() {
  return read(KEYS.tutorialDone, false) === true;
}
export function markTutorialDone() {
  write(KEYS.tutorialDone, true);
}

// ─── ウォレット（単一通貨 CHIP） ───
// 対戦ゲームでよくある「見た目の品を買うためだけの通貨」。対戦の参加費や掛け金と紐づいた
// ウォレットは持たない。
//
// **卓の上の賭け金とウォレットは完全に切り離す。** 局で賭けるのはライフであって所持金では
// ないので、ウォレットが対戦の勝敗に介入する経路が1本も無い——参加費も無ければ、負けても
// 残高は減らない。CHIPは「遊んだ量と勝敗に応じて増えるだけの、コスメを買うための通貨」で、
// 旧三通貨(POINT/CHIP/GEM)と変換UIは丸ごと廃止した（交換レートを覚える必要そのものを無くす）。
//
// 名前をCHIPにしたのは、卓からチップが引退して(賭ける単位がライフになった)語が空いたから。
// **0未満にはならない**——賭けに連動しないので、借金という概念自体が無い。
export function getChips() {
  return read(KEYS.chips, 0);
}
export function addChips(amount) {
  const total = Math.max(0, getChips() + Math.round(Number(amount) || 0));
  write(KEYS.chips, total);
  return total;
}

// 旧GEM残高の繰り越し。**1度だけ**走らせて旧キーを消す（毎回足すと無限に増える）。
// POINT/CHIPは繰り越さない: あちらは卓の持ち点の清算で、マイナスにもなりうる別物の数字だった。
export function migrateLegacyWallet() {
  const legacy = read(KEYS.legacyGems, null);
  if (legacy == null) return;
  addChips(Math.max(0, Number(legacy) || 0));
  try { localStorage.removeItem(KEYS.legacyGems); } catch { /* 消せない環境では何もしない */ }
}

// 初回の持参金。**このプロジェクトの読者は1〜2試合しか触らない**（コンテストの審査員）ので、
// 0から始めると 1試合10〜44 CHIP に対して最安のスキンが80 CHIP——**ショップは最後まで
// 一度も使えない部屋になる**。「稼ぐ→買う→装備する」の輪が一周も回らないまま終わるのは、
// 遊べる機能が1つ死んでいるのと同じ。
//
// 額はレア1つ(220)を買っておつりが出る線。**エピック(460)に届かせないこと**——最初から
// 全部買えると、その後の対戦で得るCHIPが何の意味も持たなくなる。
export const WELCOME_CHIPS = 300;
export function grantWelcomeChips() {
  if (read(KEYS.welcomeGranted, false)) return 0;
  write(KEYS.welcomeGranted, true);
  addChips(WELCOME_CHIPS);
  return WELCOME_CHIPS;
}

// 1試合の報酬。**負けても必ずbaseは出る**——遊んだこと自体に対価を置かないと、勝てない人ほど
// コスメから遠ざかって戻ってこなくなる。残ライフ分の上乗せは「勝ち方の質」に少しだけ報いる項。
//
// **livesLeftは開始ライフを超える。** ライフはゼロサムなので、ノックアウトで勝つと相手のぶんも
// 手元にある（カジュアルなら最大12）。実際の幅は 10（負け・残0）〜54（カジュアルの完勝）で、
// ランクは58まで。ここを「開始ライフが上限」と読み違えると、ショップの価格設定がずれる。
export const MATCH_REWARD = { base: 10, win: 20, perLifeLeft: 2 };
export function matchReward({ won, livesLeft = 0 }) {
  return MATCH_REWARD.base + (won ? MATCH_REWARD.win : 0) + Math.max(0, livesLeft) * MATCH_REWARD.perLifeLeft;
}

// 「ライフを1つも失わずに勝ったか」。**実績「無傷」と完封ボックスの両方がここだけを見る。**
// 同じ式を2箇所に書いていたせいで、次の不具合が**両方に同時に**入っていた（勝つと毎回完封ボックスが出ていた）:
//
//   `livesLeft >= totalLives` で判定していた——だがすぐ上の注記の通り**livesLeftは開始ライフを
//   超える**（ライフはゼロサムなので、ノックアウトで勝つと相手のぶんも手元にある）。つまりこの式は
//   **ノックアウト勝ちなら常に真**で、実測のノックアウト率（カジュアル65.4%／ランク78.3%）が
//   そのまま「無傷」の頻度になっていた。いちばん難しいはずの条件が、勝ち方の既定値だったということ。
//
// **minLives（局ごとの最小値）で見ること。** 1つでも失えば totalLives を下回るので、ゼロサムで
// 増えた分に汚染されない。切断勝ちを除くのは、forfeitが残った側のライフを一切削らないため。
export function isFlawlessWin(e) {
  return !!e?.won && e.reason !== "forfeit" && (e.minLives ?? 0) >= e.totalLives;
}

export function getOwnedSkins() {
  return read(KEYS.ownedSkins, ["classic"]); // classicは初期装備の無料スキン
}
export function addOwnedSkin(id) {
  const list = getOwnedSkins();
  if (!list.includes(id)) { list.push(id); write(KEYS.ownedSkins, list); }
}
export function getEquippedSkin() {
  return read(KEYS.equippedSkin, "classic");
}
export function setEquippedSkin(id) {
  write(KEYS.equippedSkin, id);
}

// ─── 所持テーブルスキン（賭け卓の見た目、CardArt.jsxのCARD_THEMESと同じ構造のTABLE_THEMES） ───
export function getOwnedTables() {
  return read(KEYS.ownedTables, ["classic"]); // classicは初期装備の無料テーブル
}
export function addOwnedTable(id) {
  const list = getOwnedTables();
  if (!list.includes(id)) { list.push(id); write(KEYS.ownedTables, list); }
}
export function getEquippedTable() {
  return read(KEYS.equippedTable, "classic");
}
export function setEquippedTable(id) {
  write(KEYS.equippedTable, id);
}

// ─── 所持称号（実績由来の称号とは別に、ショップ・報酬ボックスで手に入る称号のIDリスト） ───
// 装備中の称号(equippedTitle)は実績由来・ショップ/ボックス由来を問わず表示ラベル文字列そのものを保存する
// （既存の実績称号の保存形式に合わせる。SettingsScreen/SkinScreenの両方から同じキーを読み書きする）。
export function getOwnedTitles() {
  return read(KEYS.ownedTitles, []);
}
export function addOwnedTitle(id) {
  const list = getOwnedTitles();
  if (!list.includes(id)) { list.push(id); write(KEYS.ownedTitles, list); }
}

// ─── 設定 ───
export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}
export function saveSettings(partial) {
  const merged = { ...getSettings(), ...partial };
  write(KEYS.settings, merged);
  return merged;
}

// ─── データリセット（設定画面から呼び出す） ───
export function resetAllData() {
  Object.values(KEYS).forEach((k) => {
    try { localStorage.removeItem(k); } catch { /* noop */ }
  });
}

// ─── デイリーログイン（日数消化型：連続でなくてもログイン日数分だけ進行） ───
// 呼び出し側は返り値のisNewDayを見て、新規ログイン報酬の演出を出すかどうかを判断する。
//
// **「今日」はローカル日付で数えること。** `toISOString()` はUTCを返すので、日本(UTC+9)では
// 日付の変わり目が朝9時になる——同じ日の8時と10時に開くと**ボーナスが2回出て**、
// 逆に深夜0時をまたいでも翌朝9時までは新しい日にならない（実測で確認）。
// プレイヤーが見ているのは手元のカレンダーなので、そちらに合わせる。
const localDateKey = (d = new Date()) => {
  const p2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

export function checkDailyLogin() {
  const today = localDateKey();
  const last = read(KEYS.lastLogin, null);
  if (last === today) {
    return { isNewDay: false, loginDays: read(KEYS.loginDays, 1) };
  }
  const days = read(KEYS.loginDays, 0) + 1;
  write(KEYS.lastLogin, today);
  write(KEYS.loginDays, days);
  return { isNewDay: true, loginDays: days };
}
