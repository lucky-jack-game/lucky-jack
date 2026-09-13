// コスメ（カード/卓/称号）の在庫と、報酬ボックスの抽選。
//
// **ここがJSXから分かれているのは、テストから読めるようにするため。** 元は画面のファイルの中に
// 在庫と抽選が同居していたが、あのファイルはJSXを含むので `node --test` から import できない
// ——つまり在庫表には一度もテストが当たっていなかった。実際にそれで次の事故が起きていた:
//
//   `BOX_TYPES`（storage.js）を victory/flawless へ改名したとき `BOX_POOLS` の鍵が旧トーナメント
//   仕様の champion/grandSlam のまま残り、**どのボックスを開けても pool が undefined** になっていた。
//   空のプールは「中身が全て所持済み」と見分けが付かないので、開封は毎回かぶり分岐へ落ち、
//   既定値の称号1つを「かぶり」として見せてCHIPだけ払う——**限定品9点が1つも出ない状態**で、
//   画面には何のエラーも出ない（抽選の失敗は、当たりが出ないことと区別できない）。
//
// だから在庫は**鍵を BOX_TYPES から引く**形にし、テスト（cosmetics.test.js）が
// 「全てのボックスに非空のプールがある」「ショップの在庫と1点も交わらない」を固定する。
import {
  BOX_TYPES, addChips,
  getOwnedSkins, addOwnedSkin,
  getOwnedTables, addOwnedTable,
  getOwnedTitles, addOwnedTitle,
} from "./storage.js";

// 称号の実体。実績由来の称号(storage.jsのACHIEVEMENTS)とは別枠で、ownedTitles(storage.js)に
// 解放済みIDを持つ。装備中の値自体は実績称号と同じく表示ラベル文字列で保存する
// （SettingsScreen/SkinScreenのどちらから装備しても同じequippedTitleキーを共有するため）。
//
// **称号は短く保つこと。** 対戦画面では名前の隣の小さなバッジとして出るので、
// 長い称号は相手の名前を押し出す（既存で最長の「ラッキースター」7文字が上限の目安）。
// 意味の重複も避ける（例:「ポーカーフェイス」と「鉄面皮」を両方置かない）——
// 称号は名乗りなので、同じことを言う札が2枚あると選ぶ理由が無くなる。
export const COSMETIC_TITLES = {
  title_luckystar: { label: "ラッキースター", rarity: "rare" },
  title_cardShark: { label: "カードシャーク", rarity: "rare" },
  title_pokerFace: { label: "ポーカーフェイス", rarity: "rare" },
  title_prospector: { label: "山師", rarity: "rare" },
  title_highroller: { label: "ハイローラー", rarity: "epic" },
  title_allOrNothing: { label: "一擲千金", rarity: "epic" },
  title_jackpotKing: { label: "豪運の王", rarity: "legendary" },
  title_nightCity: { label: "不夜城の王", rarity: "legendary" },
  // ── ボックス限定（ショップには絶対に並ばない）──
  title_crowned: { label: "戴冠者", rarity: "epic" },
  title_triumph: { label: "凱旋", rarity: "epic" },
  title_flawless: { label: "無敗の証明", rarity: "legendary" },
  // idは所持データのキーなので変えない（変えると既に持っている人の称号が消える）。
  // ラベルだけ差し替えた: "GRAND SLAM" は撤去済みのモード名で、すぐ上の「短く保つこと」にも反していた。
  title_grandSlam: { label: "完全制覇", rarity: "legendary" },
  title_twinCrowns: { label: "双璧", rarity: "legendary" },
};

// カード/卓/称号という3種類のコスメを、所持判定と付与だけの差分に畳む。
// ショップとボックスの両方がこの1箇所を参照する（種類ごとに処理を書き分けない）。
// **表示名はここに持たない**——ラベルの出所は CardArt.jsx / TableArt.jsx の絵の定義そのもので、
// それを読むとこのファイルがJSXに依存し、テストから読めなくなる（このファイルの存在理由が消える）。
export const COSMETIC_OWNERSHIP = {
  skin: { isOwned: (refId) => getOwnedSkins().includes(refId), grant: (refId) => addOwnedSkin(refId) },
  table: { isOwned: (refId) => getOwnedTables().includes(refId), grant: (refId) => addOwnedTable(refId) },
  title: { isOwned: (refId) => getOwnedTitles().includes(refId), grant: (refId) => addOwnedTitle(refId) },
};

export const item = (type, refId, rarity) => ({ id: `${type}_${refId}`, type, refId, rarity });

// ショップの在庫プール。classic(初期装備、全員が無料で所持済み)は含めない。
// ボックス限定品もここには絶対に入れないこと——「勝ってしか手に入らない」ことが価値の源泉なので、
// CHIPで買える経路を作った瞬間にボックスの意味が消える。
export const SHOP_STOCK = [
  item("skin", "neonCyan", "rare"),
  item("skin", "emerald", "rare"),
  item("skin", "crimsonVIP", "epic"),
  item("skin", "voidPurple", "legendary"),
  // 2色構成のスキン（CardArt.jsx/TableArt.jsxの該当セクション参照）。カードと卓は同じidで対になる。
  item("skin", "patinaCrimson", "rare"),
  item("skin", "copperJade", "rare"),
  item("skin", "steelAmber", "epic"),
  item("skin", "amethystGold", "legendary"),
  item("table", "neonCyan", "rare"),
  item("table", "emerald", "rare"),
  item("table", "crimsonVIP", "epic"),
  item("table", "voidPurple", "legendary"),
  item("table", "patinaCrimson", "rare"),
  item("table", "copperJade", "rare"),
  item("table", "steelAmber", "epic"),
  item("table", "amethystGold", "legendary"),
  item("title", "title_luckystar", "rare"),
  item("title", "title_cardShark", "rare"),
  item("title", "title_pokerFace", "rare"),
  item("title", "title_prospector", "rare"),
  item("title", "title_highroller", "epic"),
  item("title", "title_allOrNothing", "epic"),
  item("title", "title_jackpotKing", "legendary"),
  item("title", "title_nightCity", "legendary"),
];

// ボックスの中身。ショップの在庫と重複させない（限定であることが唯一の入手動機のため）。
//
// **鍵は storage.js の BOX_TYPES と同じでなければならない**（下の ASSERT と cosmetics.test.js が固定）。
// 難度の順に中身を分ける: 勝利ボックスは**勝てば毎回**出るのでエピック、完封ボックスは
// ライフを1つも失わずに勝つ必要があるのでレジェンダリー。「無敗の証明」は名前の通り完封側に置く。
export const BOX_POOLS = {
  victory: [
    item("skin", "laurel", "epic"),
    item("table", "laurel", "epic"),
    item("title", "title_crowned", "epic"),
    item("title", "title_triumph", "epic"),
  ],
  flawless: [
    item("skin", "sovereign", "legendary"),
    item("table", "sovereign", "legendary"),
    item("title", "title_flawless", "legendary"),
    item("title", "title_grandSlam", "legendary"),
    item("title", "title_twinCrowns", "legendary"),
  ],
};

// ショップの価格。レア度だけで決まる（同じレア度なら種類を問わず同額＝迷わせない）。
export const SHOP_PRICE = { common: 80, rare: 220, epic: 460, legendary: 900 };
export const SHOP_SLOTS = 4;

// 中身が全て所持済みだったボックスの代償。開封が完全な空振りになることを防ぐだけの額で、
// **1試合の報酬の上限（matchReward の最大 54）を超えさせないこと**（cosmetics.test.js が固定）。
// 旧ガチャ由来の epic 90 / legendary 220 は、ボックスがトーナメント優勝でしか出なかった頃の値
// ——いまは**勝つたびに勝利ボックスが出る**ので、その額だと限定品を集め終えた後は
// 「ボックスのかぶりが主収入」になり、ショップの価格（エピック460）が勝手に安くなる。
export const BOX_DUPLICATE_CHIP_AWARD = { common: 10, rare: 20, epic: 30, legendary: 50 };

// ボックスの中身の定義。**無いボックスは開けさせない**（消費もしない）。
// 以前は抽選側が `?? 既定の称号` で埋めていたため、定義の抜けが「かぶり」に化けて見えなくなっていた。
export function boxPool(boxType) {
  const pool = BOX_POOLS[boxType];
  return pool && pool.length > 0 ? pool : null;
}

// ボックスの中身を1つ決める。**未所持のものを優先する**ので、一部だけ所持済みのときは
// 残っている未所持の中からしか出ない（＝かぶりは全部揃ってからしか起きない）。
// 全て所持済みならレア度に応じたCHIPに変換する（開封が完全な空振りになる体験を避ける）。
// randを差し替えられるのはテストのため（本番は Math.random のまま）。
export function rollBoxReward(boxType, rand = Math.random) {
  const pool = boxPool(boxType);
  if (!pool) return null;
  const fresh = pool.filter((it) => !COSMETIC_OWNERSHIP[it.type].isOwned(it.refId));
  if (fresh.length > 0) {
    const picked = fresh[Math.floor(rand() * fresh.length)];
    COSMETIC_OWNERSHIP[picked.type].grant(picked.refId);
    return picked;
  }
  const picked = pool[Math.floor(rand() * pool.length)];
  const chipAward = BOX_DUPLICATE_CHIP_AWARD[picked.rarity] ?? BOX_DUPLICATE_CHIP_AWARD.rare;
  addChips(chipAward);
  return { ...picked, duplicate: true, chipAward };
}

// 鍵の取り違えは「当たりが出ない」という形でしか現れず、画面からは運が悪いのと区別できない。
// テストでも固定してあるが、開発サーバーでも気付けるように読み込み時に1度だけ言う。
if (import.meta.env?.DEV) {
  for (const type of Object.keys(BOX_TYPES)) {
    if (!boxPool(type)) console.error(`[cosmetics] BOX_POOLS["${type}"] が無い——このボックスは何も出さない`);
  }
}
