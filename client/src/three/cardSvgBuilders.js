// client/src/Prototype3D.jsx（dev専用検証プロトタイプ）で試作したカードSVG生成ロジックを、
// 本番の対戦画面(three/Card3D.jsx)からも参照できる共有モジュールとして独立させたもの。
// SVG文字列の設計自体はPrototype3D.jsxでの試行錯誤をそのまま踏襲する。

import { getCardPalette3D } from "../CardArt.jsx";

// スキン未指定時のフォールバック。スキンの定義そのものはCardArt.jsxのCARD_THEMES[id].threeが
// 単一の情報源で、ここでは値を複製せず解決関数から取り出すだけにする。
const CLASSIC_CARD_PALETTE = getCardPalette3D("classic");

// 色ごとの質感プリセット。縁取り(Queen/King/Joker/数字共通)は磨いた金属寄り。
export const METAL = { metalness: 0.88, roughness: 0.26, clearcoat: 0.55, clearcoatRoughness: 0.13 };
export const LACQUER_BODY = { metalness: 0.05, roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.15 };
export const LACQUER_FIELD = { metalness: 0.08, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.1 };

// カード土台(本体+二重縁取り+四隅の飾り)。本物のCardArt.jsxの色分けに合わせ、Queen=金・
// King宣言=緑・Joker宣言=赤をそのまま踏襲し、枠色だけ変えて「同じ台紙のデッキ」という統一感を保つ。
function cardFrame(accentOuter, accentMid, fieldColor = "#3a0d14", bodyColor = "#0c0808") {
  return `
    <rect x="2" y="2" width="236" height="336" rx="24" fill="${bodyColor}" />
    <rect x="10" y="10" width="220" height="320" rx="18" fill="${accentOuter}" />
    <rect x="18" y="18" width="204" height="304" rx="14" fill="${fieldColor}" />
    <rect x="24" y="24" width="192" height="292" rx="12" fill="${accentMid}" />
    <rect x="27" y="27" width="186" height="286" rx="11" fill="${fieldColor}" />
    <path fill="${accentMid}" d="M42 47 L50 39 L58 47 L50 55 Z" />
    <path fill="${accentMid}" d="M198 47 L190 39 L182 47 L190 55 Z" />
    <path fill="${accentMid}" d="M42 293 L50 285 L58 293 L50 301 Z" />
    <path fill="${accentMid}" d="M198 293 L190 285 L182 293 L190 301 Z" />
  `;
}

// カード土台+イラスト差し込み(縁いっぱいまで一枚絵で埋める版)。
//
// 実際に踏んだ不具合(イラスト読み込み中の白飛び): イラスト層はReliefMesh(three/SvgMesh3D.jsx)で
// 描かれ、テクスチャが読み終わるまでnullを返す。以前はそのすぐ下がaccentMidの巨大な板(192×292)で、
// これがMETALプリセット(metalness 0.88)のままカメラ・正面補助光へ完全正対していたため、
// 面上のどの点でも反射角が同じになり、ハイライトが点ではなく面全体に広がって真っ白に飛んでいた
// (カード表示の一瞬だけ白いカードが見える)。イラスト層の直下にマットなfieldColorの板を1枚挟み、
// 読み込み中に露出するのが金属ではなく暗い漆面になるようにして解消した。
function portraitCardFrame(accentOuter, accentMid, insertColorKey, fieldColor = "#3a0d14", bodyColor = "#0c0808") {
  return `
    <rect x="2" y="2" width="236" height="336" rx="24" fill="${bodyColor}" />
    <rect x="10" y="10" width="220" height="320" rx="18" fill="${accentOuter}" />
    <rect x="18" y="18" width="204" height="304" rx="14" fill="${fieldColor}" />
    <rect x="24" y="24" width="192" height="292" rx="12" fill="${accentMid}" />
    <rect x="26" y="26" width="188" height="288" rx="11" fill="${fieldColor}" />
    <rect x="27" y="27" width="186" height="286" rx="11" fill="${insertColorKey}" />
    <path fill="${accentMid}" d="M42 47 L50 39 L58 47 L50 55 Z" />
    <path fill="${accentMid}" d="M198 47 L190 39 L182 47 L190 55 Z" />
    <path fill="${accentMid}" d="M42 293 L50 285 L58 293 L50 301 Z" />
    <path fill="${accentMid}" d="M198 293 L190 285 L182 293 L190 301 Z" />
  </svg>`;
}

const NUMBER_ROMAN = {
  1: "I", 2: "II", 3: "III", 4: "IV", 5: "V",
  6: "VI", 7: "VII", 8: "VIII", 9: "IX", 10: "X",
};

// このゲームはI〜Vのローマ数字表記(NUMBER_ROMAN、shared.jsxのNUMBER_ROMANと同じ体系)なので、
// アラビア数字の曲線グリフではなく縦棒+シェブロン(V字)だけで構成する。SVGLoaderは<text>要素を
// パースできない(フォント→パス変換をしないため)ため、数字は必ずパスの直線座標で手組みする必要がある。
// V(78,115)-(120,245)-(162,115)のシェブロン形状は数字カード「V」として既に目視検証済みの座標をそのまま
// 流用し、IVはこのシェブロンを幅60に線形縮小して"I"の縦棒と組み合わせる(座標は手計算、曲線を使わない
// ことで検証なしでも破綻しにくい形にしている)。複数の棒は1つの<path>のd属性に複数のM..Zサブパスとして
// まとめ、diamondLatticePath()と同じ技法で1レイヤー(同一Z奥行き)として扱わせる。
//
// Ⅵ〜Ⅹは現行ルールへの移行で増えた。**手書きの座標を
// 5つ増やすのではなく、既に目視検証済みのV字から組み立てる**——座標を書き写すほど取り違える。
const GY_TOP = 115, GY_BOT = 245, GY_MID = 180;

// 縦棒。x が左端、w が幅。
const bar = (x, w) => `M${x} ${GY_TOP} L${x + w} ${GY_TOP} L${x + w} ${GY_BOT} L${x} ${GY_BOT} Z`;

// V字（シェブロン）。cx が中心、w が全幅。太さは幅に比例させる。
// w=84・cx=120 のとき、目視検証済みの元の "V" の座標とちょうど一致する
// （M78 115 L120 245 L162 115 L138 115 L120 195 L102 115 Z）。
const chev = (cx, w) => {
  const a = w / 2, t = (24 * w) / 84;
  return `M${cx - a} ${GY_TOP} L${cx} ${GY_BOT} L${cx + a} ${GY_TOP} `
    + `L${cx + a - t} ${GY_TOP} L${cx} 195 L${cx - a + t} ${GY_TOP} Z`;
};

// X字。**2本の帯を重ねて描かないこと**——SVGLoaderは重なったサブパスの巻き方向によっては
// 片方を穴として扱うので、交差部分が抜けうる。12点の1本の輪郭として組む。
const ex = (cx, w) => {
  const a = w / 2, b = (20 * w) / 84, c = (17 * w) / 84;
  return `M${cx - a} ${GY_TOP} L${cx - a + b} ${GY_TOP} L${cx} 163 L${cx + a - b} ${GY_TOP} `
    + `L${cx + a} ${GY_TOP} L${cx + c} ${GY_MID} L${cx + a} ${GY_BOT} L${cx + a - b} ${GY_BOT} `
    + `L${cx} 197 L${cx - a + b} ${GY_BOT} L${cx - a} ${GY_BOT} L${cx - c} ${GY_MID} Z`;
};

const NUMBER_GLYPHS = {
  1: "M111 115 L131 115 L131 245 L111 245 Z",
  2: "M92 115 L112 115 L112 245 L92 245 Z M128 115 L148 115 L148 245 L128 245 Z",
  3: "M82 115 L98 115 L98 245 L82 245 Z M112 115 L128 115 L128 245 L112 245 Z M142 115 L158 115 L158 245 L142 245 Z",
  4: "M78 115 L96 115 L96 245 L78 245 Z M102 115 L132 245 L162 115 L145 115 L132 195 L119 115 Z",
  5: chev(120, 84),
  // 文字数が増えるほど1画あたりを細くして、全体の横幅を 50〜190 に収める
  // （カードのviewBoxは240幅。ここを超えると枠に食い込む）。
  6: `${chev(108, 70)} ${bar(151, 16)}`,
  7: `${chev(100, 64)} ${bar(138, 14)} ${bar(158, 14)}`,
  8: `${chev(94, 56)} ${bar(127, 12)} ${bar(144, 12)} ${bar(161, 12)}`,
  9: `${bar(73, 16)} ${ex(132, 70)}`,
  10: ex(120, 84),
};

// 数字カード(I〜V)。paletteはCardArt.jsxのCARD_THEMES[id].three（getCardPalette3D()で解決したもの）で、
// ショップ/報酬ボックスで手に入るスキンの3D版そのもの。未指定時はclassicのアンティークゴールド。
//
// フィールド色(カード面のベース)は以前、裏面(buildCardBackSvg)と同じ暗い臙脂 #3a0d14 だった。
// 表と裏でベースの色が同一だと、卓に並んだ時にどちらが伏せ札かひと目で判別できないという指摘を
// 受けたため、表面だけ深い藍(#16224a)に変更した。枠のアンティークゴールドは表裏で共通のまま残し、
// 「同じデッキの表と裏」という統一感は保つ。数字グリフも臙脂の上での金(#e8c874)から、藍の上で
// より明度差が出る淡い象牙色(#f4e7bf)へ寄せて可読性を上げている。この「表は明るい面／裏は暗い面」
// という関係は全スキンで踏襲する(CARD_THEMESのfieldFront/fieldBack)。
export function buildNumberCardSvg(number, palette = CLASSIC_CARD_PALETTE) {
  const { accentOuter, accentMid, bodyColor, glyphColor } = palette;
  const fieldColor = palette.fieldFront;
  const glyph = NUMBER_GLYPHS[number] || NUMBER_GLYPHS[1];
  const svg = `
    <svg viewBox="0 0 240 340" xmlns="http://www.w3.org/2000/svg">
      ${cardFrame(accentOuter, accentMid, fieldColor, bodyColor)}
      <rect x="93" y="98" width="54" height="4" fill="${accentMid}" />
      <path fill="${glyphColor}" d="${glyph}" />
      <rect x="93" y="251" width="54" height="4" fill="${accentMid}" />
    </svg>
  `.trim();
  const materials = {
    [bodyColor.toLowerCase()]: LACQUER_BODY,
    [accentOuter.toLowerCase()]: METAL,
    [fieldColor.toLowerCase()]: LACQUER_FIELD,
    [accentMid.toLowerCase()]: METAL,
    // 淡い象牙色は金より明るいぶん自己発光を強くすると白飛びするため、旧0.4から控えめにする。
    [glyphColor.toLowerCase()]: { ...METAL, emissiveIntensity: 0.22 },
  };
  return { svg, materials, label: NUMBER_ROMAN[number] || "" };
}

// カード裏面。左右・上下対称の紋様で統一する(実物トランプと同じくどちら向きでも同じに見える設計)。
function diamondLatticePath(color) {
  const dots = [];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 5; col++) {
      const cx = 62 + col * 30 + (row % 2 === 1 ? 15 : 0);
      const cy = 75 + row * 33;
      if (cx < 45 || cx > 195 || cy < 60 || cy > 280) continue;
      dots.push(`M${cx} ${cy - 6} L${cx + 6} ${cy} L${cx} ${cy + 6} L${cx - 6} ${cy} Z`);
    }
  }
  return `<path fill="${color}" d="${dots.join(" ")}" />`;
}

export function buildCardBackSvg(palette = CLASSIC_CARD_PALETTE) {
  const { accentOuter, accentMid, bodyColor, latticeColor, emblemColor } = palette;
  const fieldColor = palette.fieldBack;
  const svg = `
    <svg viewBox="0 0 240 340" xmlns="http://www.w3.org/2000/svg">
      ${cardFrame(accentOuter, accentMid, fieldColor, bodyColor)}
      ${diamondLatticePath(latticeColor)}
      <circle cx="120" cy="170" r="52" fill="${emblemColor}" />
      <circle cx="120" cy="170" r="45" fill="${fieldColor}" />
      <path fill="${emblemColor}" d="M120 132 L129 161 L158 170 L129 179 L120 208 L111 179 L82 170 L111 161 Z" />
    </svg>
  `.trim();
  const materials = {
    [bodyColor.toLowerCase()]: LACQUER_BODY,
    [accentOuter.toLowerCase()]: METAL,
    [fieldColor.toLowerCase()]: LACQUER_FIELD,
    [accentMid.toLowerCase()]: METAL,
    [latticeColor.toLowerCase()]: METAL,
    [emblemColor.toLowerCase()]: { ...METAL, emissiveIntensity: 0.4 },
  };
  return { svg, materials };
}

const PORTRAIT_INSERT_KEY = "#f0c8c8"; // 各特殊札共通のダミー挿入色キー(実際の画像で上書きされる)

// **差し込む絵は public/card-art/*.webp（640x853）。元のPNGは client/art-src/card-art/ に残してある。**
// 元は1086x1448のPNGで1枚あたり2.1〜2.4MB、4枚で8.7MBがビルドに乗っていた——この画面のJSは
// gzip 95KBまで詰めてあるのに、その90倍を画像が持っていったことになる（審査員が最初に待つのは
// ここ）。カードのSVGは240x340なので640幅でも2倍以上あり、見た目は変わらない。
// **絵を差し替えるときは art-src の側を原本にして、同じ寸法・形式で書き出すこと。**

const SPECIAL_PORTRAIT_CONFIG = {
  queen: { accentOuter: "#a8801f", accentMid: "#c9971f", image: `${import.meta.env.BASE_URL}card-art/queen.webp` },
  king: { accentOuter: "#2f6b46", accentMid: "#3f9463", image: `${import.meta.env.BASE_URL}card-art/king.webp` },
  joker: { accentOuter: "#7a2530", accentMid: "#a53341", image: `${import.meta.env.BASE_URL}card-art/joker.webp` },
};

// QUEEN/KING/JOKERのイラスト差し込み版。special: "queen"|"king"|"joker"
// (内部specialフラグ"king"=QUEEN と紛らわしいため、ここでは表示上の役割名で受け取る)。
//
// 枠の金属色(accentOuter/accentMid)だけはスキンではなく役割の色(Queen=金/KING宣言=緑/
// JOKER宣言=赤)を必ず使う——この3色はルール上の意味を運んでおり(CardArt.jsxの2D版も同じ)、
// スキンで塗り替えると「今どの札か」が読めなくなるため。スキンは本体(bodyColor)とフィールド色に
// 効かせ、装備中のデッキの一部であることが分かる程度に留める。
export function buildPortraitCardSvg(special, palette = CLASSIC_CARD_PALETTE) {
  const cfg = SPECIAL_PORTRAIT_CONFIG[special] || SPECIAL_PORTRAIT_CONFIG.queen;
  const fieldColor = palette.fieldBack;
  const svg = `<svg viewBox="0 0 240 340" xmlns="http://www.w3.org/2000/svg">${portraitCardFrame(cfg.accentOuter, cfg.accentMid, PORTRAIT_INSERT_KEY, fieldColor, palette.bodyColor)}`;
  const materials = {
    [palette.bodyColor.toLowerCase()]: LACQUER_BODY,
    [cfg.accentOuter.toLowerCase()]: METAL,
    [fieldColor.toLowerCase()]: LACQUER_FIELD,
    [cfg.accentMid.toLowerCase()]: METAL,
    [PORTRAIT_INSERT_KEY]: { metalness: 0.05, roughness: 0.6, clearcoat: 0.3, clearcoatRoughness: 0.3, texture: cfg.image, relief: true },
  };
  return { svg, materials };
}

