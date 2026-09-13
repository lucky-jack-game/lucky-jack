// オンライン対戦の段位（ランクマッチ）の定義。
//
// 設計の要点:
//  - **オンラインのランクマッチだけのシステム**。カジュアルとCPU練習では一切動かない
//    （書き込み口は battle/matchStats.js の finishMatch ただ1つ）。オンラインをCPUで
//    埋めない方針になったので、旧仕様の「CPU相手でもRPが動く／買い込みで無限周回を抑える」は
//    前提ごと消えている。**その記述を復活させないこと。**
//  - ランク差による増減の補正は行わない（固定値）。サーバー側にレーティング計算を持たせない。
//  - 最下段STONEの0 RPが底で、**負の数は一度も画面に出さない**。「ブロンズ −100」のような
//    表記は達成度ではなく不具合に見えるうえ、どこまで下がるのかの底が見えないため採らない。
//  - 最上位MONARCHはRPではなく**席数**で決まる（DIAMOND到達者のうちRP上位10名）。
//    全プレイヤーを横断して数える場所が要るため、**Firebase移行後にのみ有効化できる**。
//    それまでMONARCHは定義だけ存在し、誰も到達しない（実在しない順位を捏造しないため）。
//
// 段位の色は、カード/卓が確立したアンティークゴールド体系と喧嘩しない範囲で
// 「金属としての序列」が読めるように組んである（from=ハイライト側 / to=陰側 / line=縁取り）。

export const RP_PER_TIER = 100;      // 1段 = 100 RP
export const RP_PER_MATCH = 20;      // ランクマッチ1試合あたりの増減（固定）
export const RP_DEMOTION_LANDING = 75; // 降格直後の着地点（境界での往復を防ぐ）
export const MONARCH_SEATS = 10;     // 最上位の席数

export const RANK_TIERS = [
  { id: "stone",    label: "STONE",    jp: "ストーン",   marks: 1, from: "#8a8279", to: "#3a3632", line: "#a09689" },
  { id: "iron",     label: "IRON",     jp: "アイアン",   marks: 2, from: "#a3a6ad", to: "#3b3d44", line: "#c2c5cc" },
  { id: "bronze",   label: "BRONZE",   jp: "ブロンズ",   marks: 3, from: "#d9975a", to: "#5c3618", line: "#f0b072" },
  { id: "silver",   label: "SILVER",   jp: "シルバー",   marks: 1, from: "#eef3f7", to: "#7b858f", line: "#ffffff" },
  { id: "gold",     label: "GOLD",     jp: "ゴールド",   marks: 2, from: "#fdf6e0", to: "#8d6c25", line: "#ffe9a8" },
  { id: "platinum", label: "PLATINUM", jp: "プラチナ",   marks: 3, from: "#eefffb", to: "#5f8f87", line: "#c8f5ea" },
  // marksは盾の中に収まる4本が上限（5本にすると最上段が盾の縁からはみ出して欠ける）。
  // DIAMONDとMONARCHは同じ4本だが、MONARCHは盾の上に王冠が載るので取り違えない。
  { id: "diamond",  label: "DIAMOND",  jp: "ダイヤ",     marks: 4, from: "#e6faff", to: "#3d7fb8", line: "#9fe8ff" },
  { id: "monarch",  label: "MONARCH",  jp: "モナーク",   marks: 4, from: "#fff3cf", to: "#7a3fb0", line: "#ffd98a", crown: true },
];

export const RANK_BY_ID = Object.fromEntries(RANK_TIERS.map((t) => [t.id, t]));

// 段位の序列。2つの段位を比べるときは必ずこれを通すこと（RANK_TIERSのindexOfを
// 呼び出し側に書かせると、段位を1つ挿入した瞬間に全箇所を直す羽目になる）。
export function rankIndex(tier) {
  return RANK_TIERS.findIndex((t) => t.id === (tier && tier.id));
}

// 通算RPが指定の段位に届いているか。**段位由来の実績（storage.jsのACHIEVEMENTS）はこれで判定する。**
// 「今その段位か」ではなく「その段位以上か」で見るのが肝: 実績は一度解放したら取り消さない一方、
// RPは降格で下がりうるので、等号で見ると DIAMOND のプレイヤーが BRONZE の実績を持てない
// （＝先に上へ行った人ほど下の実績が埋まらない）という逆転が起きる。
export function hasReachedTier(totalRp, tierId) {
  const target = RANK_TIERS.findIndex((t) => t.id === tierId);
  return target >= 0 && rankIndex(resolveRank(totalRp).tier) >= target;
}

// 通算RPから段位と段内の進捗を求める。MONARCHはRPでは到達できない（席数制）ため、
// RPによる算出の上限はDIAMONDに固定する。
export function resolveRank(totalRp) {
  const capped = Math.max(0, totalRp | 0);
  const diamondIndex = RANK_TIERS.findIndex((t) => t.id === "diamond");
  const index = Math.min(diamondIndex, Math.floor(capped / RP_PER_TIER));
  return {
    tier: RANK_TIERS[index],
    rpInTier: index === diamondIndex ? capped - diamondIndex * RP_PER_TIER : capped % RP_PER_TIER,
    isMax: index === diamondIndex,
  };
}

// RPを増減した結果を求める。**段位の境界の扱いはここ1箇所に閉じる**
// （呼び出し側でRPを足し引きしてから段位を引き直す形にすると、下記2つの規則が
//  加算のたびに書き写されることになり、いずれ片方だけ抜ける）。
//
//  - **底は STONE の 0 RP。** 負の数は一度も画面に出さない（「ブロンズ −100」の
//    ような表記は達成度ではなく不具合に見えるうえ、どこまで下がるのかの底が見えない）。
//  - **降格したら段内 RP_DEMOTION_LANDING(75) に着地する。** 自然に引き算すると 400→380＝
//    SILVER 80 となり、次の1勝で即座に復帰してしまう。75に落とすと復帰に2勝要るので、
//    境界を1勝ごとに往復し続ける状態にならない。**昇格側には同じ緩衝を置かない**
//    （上がる時に足止めを食わせる理由が無い）。
export function applyRpDelta(totalRp, delta) {
  const before = resolveRank(totalRp);
  const beforeIndex = RANK_TIERS.indexOf(before.tier);
  let next = Math.max(0, (totalRp | 0) + (delta | 0));
  let after = resolveRank(next);
  let afterIndex = RANK_TIERS.indexOf(after.tier);

  if (afterIndex < beforeIndex) {
    next = afterIndex * RP_PER_TIER + RP_DEMOTION_LANDING;
    after = resolveRank(next);
    afterIndex = RANK_TIERS.indexOf(after.tier);
  }
  return {
    totalRp: next,
    rank: after,
    promoted: afterIndex > beforeIndex,
    demoted: afterIndex < beforeIndex,
    tierBefore: before.tier,
    tierAfter: after.tier,
  };
}
