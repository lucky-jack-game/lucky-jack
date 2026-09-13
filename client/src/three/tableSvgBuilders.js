// テーブル(賭け卓)のSVG生成ロジック。client/src/Prototype3D.jsxで試作した内容をベースに、
// 中央エンブレム削除・角を四角形寄りに・卓を大きく・傾きを無くす、を反映した最終版。
//
// 卓に描くのは「フェルトの面と縁(レール)」だけにしてある。カードを置く位置の目印(自分/相手の場札・
// KING/JOKER宣言札・手札6枚×2)は、以前この卓SVGに固定座標で焼き込んでいたが、実際のカードは
// three/layoutAnchors.jsのワールド座標で配置されるため座標系が二重管理になり、ズレの温床だった。
// 現在は目印もカードもすべて同じ<group>の中に置く
// (three/SlotMarker.jsx + three/BattleScene3D.jsx)ため、卓側には一切描かない。

import { getTablePalette3D } from "../TableArt.jsx";

// 卓スキンのパレット(TableArt.jsxのTABLE_THEMES[id].three)未指定時のフォールバック。
const CLASSIC_TABLE_PALETTE = getTablePalette3D("classic");

const RAIL_MATERIAL = { metalness: 0.05, roughness: 0.6, clearcoat: 0.35, clearcoatRoughness: 0.3 }; // 木製レール
const TRIM_MATERIAL = { metalness: 0.9, roughness: 0.28, clearcoat: 0.5, clearcoatRoughness: 0.15 }; // 金属トリム
const FELT_MATERIAL = { metalness: 0, roughness: 0.92, clearcoat: 0 }; // フェルト生地(光沢なし、布の質感)

// 卓のSVG寸法。three/geometryCache.jsが最大寸法を4ワールド単位に正規化するため、
// レイアウト計算(three/layoutAnchors.jsのcomputeBattleLayout)がこの比率を必要とする。
// レール(縁)の厚みは向きによらず20SVG単位なので、卓が縦に厚いほどフェルト面の占める割合が
// 上がる(横長 228/268=85% / 縦長 310/350=89%)。
export const TABLE_SVG = {
  landscape: { width: 420, height: 268, feltWidth: 380, feltHeight: 228 },
  portrait: { width: 420, height: 350, feltWidth: 380, feltHeight: 310 },
};

// 卓の外形について踏んだ2つの指摘:
//  1. 以前は`rx`が高さの半分近く(120等)あり、両端が完全に丸まったスタジアム/オーバル型だった。
//     「角以外は四角に、角だけ丸く」という指示を受け、辺は直線のまま角だけ丸める角丸長方形にした。
//  2. 縁(レール)が厚すぎて、内側のフェルト面が卓全体の6割程度しかなく、場札や手札がフェルトから
//     はみ出して縁に乗ってしまっていた。レールを薄くしてフェルト面を広く取り直してある。
//
// ── なぜ横長/縦長で卓の比率を分けるのか（一度統一したものを再び分けた理由）──
// 盤面が「3行×3列のグリッド」(three/layoutAnchors.js参照)になったことで、卓に必要なのは
// 幅ではなく**フェルト面の縦幅**になった。ところが卓の大きさを縛る条件は向きで違う:
//   ・横長(PC): 卓の高さは操作ドックと名前パネルに挟まれた帯で頭打ち＝**高さで決まる**。
//     幅は余るので、卓は横に伸ばした方が余白が埋まる。
//   ・縦長(モバイル): 画面が細いので卓は**幅で決まる**。卓の比率を横長にするほど高さが
//     道連れで縮み、カードが読めない大きさまで小さくなる（1.57:1だと縦長でカード高さが
//     50px台まで落ちた）。縦長では卓を正方形に寄せるほどフェルトの縦幅が稼げる。
// 同じ比率で両立させようとすると必ずどちらかが痛むため、意匠(角丸・レールの層構成・色)は
// 完全に共通のまま、viewBoxの高さだけを2種類持つ。
export function buildTableSvg(palette = CLASSIC_TABLE_PALETTE, variant = "landscape") {
  const { rail, trim, felt } = palette;
  const H = (TABLE_SVG[variant] || TABLE_SVG.landscape).height;
  const band = (inset, rx, fill) =>
    `<rect x="${inset}" y="${inset}" width="${420 - inset * 2}" height="${H - inset * 2}" rx="${rx}" fill="${fill}" />`;
  const svg = `
    <svg viewBox="0 0 420 ${H}" xmlns="http://www.w3.org/2000/svg">
      ${band(2, 30, rail)}
      ${band(8, 27, trim)}
      ${band(13, 24, felt)}
      ${band(17, 22, trim)}
      ${band(20, 20, felt)}
    </svg>
  `.trim();
  const materials = {
    [rail.toLowerCase()]: RAIL_MATERIAL,
    [trim.toLowerCase()]: TRIM_MATERIAL,
    [felt.toLowerCase()]: FELT_MATERIAL,
  };
  return { svg, materials };
}
