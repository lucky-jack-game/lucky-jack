// カードのSVGアートワーク（手札・ショップ・ルール説明などに出る2Dの札）。
// 「賭け札」の緊張感、VIPカジノの二重フレーム/エンボス、
// ネオンサイバーパンクの発光表現(drop-shadowのみ、box-shadowは非矩形の輪郭に合わないため不使用)を融合する。
// イラスト制作パイプラインが無いため、すべて幾何学的な線画+SVGグラデーション/フィルタで構成する。
import { useId } from "react";

// 現行ルールへの移行でカードがⅠ〜Ⅹに増えた。
// **Ⅵ以降を足すときはグリフの幅に注意すること**——"VIII" は "I" の4倍近い横幅になるので、
// カード面の数字は幅に合わせて縮める必要がある（PlayingCard側でfontSizeを調整済み）。
export const NUMBER_ROMAN = {
  1: "I", 2: "II", 3: "III", 4: "IV", 5: "V",
  6: "VI", 7: "VII", 8: "VIII", 9: "IX", 10: "X",
};

// 見出し書体。**実体は index.css の :root（--font-display）。**
// SVGの presentation attribute では var() が解決されないので、必ず style 経由で渡すこと。
const DISPLAY_FONT = "var(--font-display)";

// カード面のローマ数字の大きさ。**グリフの横幅から決める**——ローマ数字は文字数がまちまちで、
// "VIII" は "I" の5倍近い横幅になるので、全部を同じ大きさで組むと枠からはみ出す。
// 内枠の幅は220px(x=15..235)なので、描画幅140pxを上限に、単体では大きくなりすぎない118pxで頭打ち。
// **書体を替えたら必ず測り直すこと**（client側で canvas の measureText を使って測った）。
// 前の書体のために測った値をそのまま使うと、字幅が違うぶん小さすぎるか、はみ出すかになる。
const ROMAN_SIZE = { 1: 118, 2: 118, 3: 118, 4: 118, 5: 118, 6: 118, 7: 101, 8: 84, 9: 118, 10: 118 };
// 字の上端から下端までの中心を、カードの中心に合わせるための基準線の位置（Interのcap heightの半分）。
// **固定値で下げてはいけない。** 以前は大きさに関わらず +34 だったので、小さく組む "VIII" だけが
// 他の札より17pxも低い位置に沈んでいた（同じ場所にあるはずの数字が札ごとに上下する）。
const CAP_CENTER = 0.3635;

export const QUEEN_COLOR = "#F2C230";
// レイズ／ベットのボタン色（fold=赤・call=緑と対になる3色目）。voidPurpleテーマと系統を合わせた紫。
// **かつて JACK_COLOR という名前だった。** Jackは現行ルールに無い札なので、色そのものは
// 生きているのに名前だけが撤去済みの仕様を指していた。役割で呼ぶこと。
export const RAISE_PURPLE = "#b06bff";

// カードのフレームカラー/背景テーマ（ショップ/報酬ボックスで手に入るコスメティック「スキン」の実体）。
// レアリティはショップの価格・ボックスの中身(screens/ShopScreen.jsx)から参照する。
// 既定テーマ`classic`は、3Dカード(three/cardSvgBuilders.js)と同じ意匠に揃えてある：
// アンティークゴールドの枠(#caa452)・深い藍の面(#1b2750)・象牙のグリフ(#f4e7bf)。
// 旧値は frame #FFD700 / bg #1a1710 / グリフ #f0f0f5 という「ネオンの金＋寒色の白」で、
// 対戦画面(3D)だけが落ち着いた金なのに、ホーム・手札・ショップ・デッキ編成に出る2Dカードは
// すべてネオンという二重基準になっていた（サイト全体の雰囲気がカードに負けて見えた
// 直接の原因の一つ。実際にはカード自体が2種類あり、非3Dの方が浮いていた）。
// 他のテーマ(neonCyan等)はショップで買って着けるコスメなので、鮮やかなままで良い。
// `three`フィールドは同じスキンの3D版パレット（three/cardSvgBuilders.jsが押し出すSVGの各層の色）。
// 2Dと3Dでスキンの定義を2箇所に分けると、片方だけ増やした時に「ショップで買ったのに対戦画面では
// 反映されない」という食い違いが起きる（実際、3D導入時にこの結線が漏れていて、装備しても対戦画面の
// カードは常にclassicのアンティークゴールドのままだった）。テーマの追加は必ずこの1箇所で完結させる。
//   bodyColor   : カード最外周の本体（漆・最も暗い）
//   accentOuter : 外側の枠リング（金属）
//   fieldFront  : 表面のフィールド色     fieldBack: 裏面のフィールド色
//   accentMid   : 内側の枠リング＋四隅の菱形（金属・外枠より明るい）
//   glyphColor  : ローマ数字グリフ       latticeColor/emblemColor: 裏面の菱形格子／中央エンブレム
// 同一パレット内で色が重複すると、その2つは同じマテリアルとして扱われ層の区別が消えるため、
// 各色は必ず互いに異なる値にすること（例: glyphColorとfieldFrontを同値にすると数字が消える）。
export const CARD_THEMES = {
  classic: {
    label: "クラシックゴールド", rarity: "common", frame: "#caa452", glow: "rgba(202,164,82,0.45)", bgFrom: "#1b2750", bgTo: "#0a0a14", glyph: "#f4e7bf",
    three: { bodyColor: "#0c0808", accentOuter: "#b8923f", accentMid: "#caa452", fieldFront: "#16224a", fieldBack: "#3a0d14", glyphColor: "#f4e7bf", latticeColor: "#7a5c2e", emblemColor: "#e8c874" },
  },
  neonCyan: {
    label: "ネオンシアン", rarity: "rare", frame: "#22e5ff", glow: "rgba(34,229,255,0.65)", bgFrom: "#0a1a22", bgTo: "#05080a",
    three: { bodyColor: "#04090c", accentOuter: "#1b7f93", accentMid: "#35c9e0", fieldFront: "#0e3145", fieldBack: "#0a2433", glyphColor: "#d6fbff", latticeColor: "#14606f", emblemColor: "#7ceeff" },
  },
  emerald: {
    label: "エメラルドフェルト", rarity: "rare", frame: "#2fffa8", glow: "rgba(47,255,168,0.55)", bgFrom: "#0a2216", bgTo: "#05080a",
    three: { bodyColor: "#040b08", accentOuter: "#1a8560", accentMid: "#34c98c", fieldFront: "#0c4230", fieldBack: "#072e20", glyphColor: "#ddfff0", latticeColor: "#12604a", emblemColor: "#74f0c0" },
  },
  crimsonVIP: {
    label: "クリムゾンVIP", rarity: "epic", frame: "#ff2f6e", glow: "rgba(255,47,110,0.6)", bgFrom: "#220a12", bgTo: "#08080d",
    three: { bodyColor: "#0b0407", accentOuter: "#92163d", accentMid: "#d42a5c", fieldFront: "#400a1d", fieldBack: "#2e0715", glyphColor: "#ffe2ea", latticeColor: "#6d1130", emblemColor: "#ff7d9f" },
  },
  voidPurple: {
    label: "ヴォイドパープル", rarity: "legendary", frame: "#b06bff", glow: "rgba(176,107,255,0.65)", bgFrom: "#180a22", bgTo: "#08080d",
    three: { bodyColor: "#08040d", accentOuter: "#5d2f9c", accentMid: "#8b53d6", fieldFront: "#2a1145", fieldBack: "#1c0b33", glyphColor: "#f1e4ff", latticeColor: "#46237a", emblemColor: "#c79bff" },
  },
  // ── 2色構成のスキン（一色で塗りつぶしたスキンだけでなく、クラシックのように2色を使うもの）──
  //
  // **枠の金属と面の色を必ず別の色相にする。** 上のneonCyan〜voidPurpleは frame も fieldFront も
  // 同じ色相の明暗違いで、事実上1色を塗り分けているだけだった（＝カードが「青いカード」「赤いカード」に
  // なってしまい、classicの持っていた「金属の枠に漆の面がはまっている」という物としての説得力が出ない）。
  // classicの構成＝暖色の金属(#caa452) × 寒色の深い面(#16224a) × 象牙のグリフ、をそのまま定式化して、
  // 金属と面の組み合わせだけを変えていく。
  //
  // 3D側の注意（既存の落とし穴）:
  //  - **同一パレット内で色を重複させないこと**。同じhexは同じマテリアルとして扱われ層の区別が消える。
  //  - fieldFrontはclassicの#16224aと同程度の明度を保つこと。3Dは陰影で暗くなる方向にしか転ばないので、
  //    2Dの背景色をそのまま持ってくるとショーケースの大きさでほぼ真っ黒に潰れる。
  //  - **銀・白金のような彩度の無い金属は作れない。** 枠はメタルのマテリアル(metalness 0.88)で
  //    描かれ、色はほぼ全て環境の映り込みで決まる。SceneCanvasのキーライトが暖色(#ffdca8)なので、
  //    彩度の無い金属は環境の色そのものになり茶色く沈む——**accentMidに#ffffffを入れても茶色く出る**
  //    ことを実測で確認済み（＝色の選び方では解決できない）。金属は必ず彩度のある色にすること。
  patinaCrimson: {
    label: "パティナクリムゾン", rarity: "rare", frame: "#59a28d", glow: "rgba(89,162,141,0.5)", bgFrom: "#3d0f1e", bgTo: "#0c0508", glyph: "#ffe8ee",
    three: { bodyColor: "#0b0406", accentOuter: "#2e6b5c", accentMid: "#59a28d", fieldFront: "#4a1224", fieldBack: "#2c0a15", glyphColor: "#ffe8ee", latticeColor: "#26564a", emblemColor: "#8fd0bb" },
  },
  copperJade: {
    label: "カッパージェイド", rarity: "rare", frame: "#d08a52", glow: "rgba(208,138,82,0.5)", bgFrom: "#0d3b34", bgTo: "#05100e", glyph: "#e8fff6",
    three: { bodyColor: "#050c0a", accentOuter: "#94572c", accentMid: "#c8834b", fieldFront: "#0f4a40", fieldBack: "#0a332c", glyphColor: "#e8fff6", latticeColor: "#7a4522", emblemColor: "#e8a874" },
  },
  steelAmber: {
    label: "スチールアンバー", rarity: "epic", frame: "#9fb0c0", glow: "rgba(159,176,192,0.55)", bgFrom: "#4a2f06", bgTo: "#0d0803", glyph: "#fff1cf",
    three: { bodyColor: "#0a0703", accentOuter: "#65758a", accentMid: "#9fb0c0", fieldFront: "#553609", fieldBack: "#3a2405", glyphColor: "#fff1cf", latticeColor: "#4a5766", emblemColor: "#c5d5e4" },
  },
  // 金×紫水晶はレジェンダリーに置く（classicの金×藍・voidPurpleの紫×紫とも被らない）。
  amethystGold: {
    label: "アメジストゴールド", rarity: "legendary", frame: "#e8c874", glow: "rgba(232,200,116,0.6)", bgFrom: "#2e1252", bgTo: "#0a0610", glyph: "#f3e6ff",
    three: { bodyColor: "#080510", accentOuter: "#a8801f", accentMid: "#e0bc63", fieldFront: "#33165c", fieldBack: "#221040", glyphColor: "#f3e6ff", latticeColor: "#7d5c9c", emblemColor: "#f0d99a" },
  },

  // ── ボックス限定（ショップには絶対に並ばない）──
  // 報酬ボックス（勝利／完封）からのみ出る。CHIPで買えないことが価値の源泉なので、
  // ショップの在庫表（cosmetics.js の SHOP_STOCK）には絶対に載せないこと。
  laurel: {
    label: "ローレルゴールド", rarity: "epic", frame: "#e8c874", glow: "rgba(232,200,116,0.55)", bgFrom: "#2a2109", bgTo: "#0c0906", glyph: "#fdf6e0",
    // fieldFrontは2Dのbg(#2a2109)より明るくしてある。そのまま持ってくると3Dのショーケースの
    // 大きさでほぼ黒に潰れる（既知の落とし穴。明度はclassicの#16224a=130と同程度を保つ）。
    three: { bodyColor: "#0a0805", accentOuter: "#9a7628", accentMid: "#d8b45e", fieldFront: "#3d2c09", fieldBack: "#211705", glyphColor: "#fdf6e0", latticeColor: "#6b5220", emblemColor: "#f0d99a" },
  },
  sovereign: {
    label: "ソヴリン", rarity: "legendary", frame: "#f4e7bf", glow: "rgba(244,231,191,0.7)", bgFrom: "#3a2c10", bgTo: "#0a0806", glyph: "#fffdf5",
    three: { bodyColor: "#0a0806", accentOuter: "#b6a06a", accentMid: "#eaddb0", fieldFront: "#2e2210", fieldBack: "#241a0b", glyphColor: "#fffdf5", latticeColor: "#7c6a3c", emblemColor: "#f7edcf" },
  },
};

// 3Dカードのパレット解決。未知のテーマIDや`three`未定義のテーマは必ずclassicへフォールバックする
// （3D側は色をマテリアルのキーとして使うため、undefinedが混ざると層ごと描画されなくなる）。
export function getCardPalette3D(themeId) {
  return (CARD_THEMES[themeId] || CARD_THEMES.classic).three || CARD_THEMES.classic.three;
}
export const RARITY_ORDER = ["common", "rare", "epic", "legendary"];
export const RARITY_COLOR = { common: "#9aa0ac", rare: "#38BDF8", epic: "#c084fc", legendary: "#FFD700" };

const W = 250, H = 350;

// 角のコーナーオーナメント（VIPトランプの二重フレームに添える小さな花形罫）
function CornerOrnaments({ color, elaborate }) {
  const pts = [[24, 24], [W - 24, 24], [24, H - 24], [W - 24, H - 24]];
  return (
    <>
      {pts.map(([x, y], i) => (
        <g key={i} transform={`translate(${x},${y})`} opacity="0.85">
          <circle r={elaborate ? 4.5 : 3} fill="none" stroke={color} strokeWidth="1.4" />
          {elaborate && <circle r="1.4" fill={color} />}
        </g>
      ))}
    </>
  );
}

function DoubleFrame({ color, filterId }) {
  return (
    <>
      <rect x="6" y="6" width={W - 12} height={H - 12} rx="16" fill="none" stroke={color} strokeWidth="1.5" opacity="0.7" />
      <rect x="15" y="15" width={W - 30} height={H - 30} rx="11" fill="none" stroke={color} strokeWidth="2.5"
        style={{ filter: filterId ? `drop-shadow(0 0 6px ${color})` : "none" }} />
    </>
  );
}

// PlayingCard: 数字カード('number')・宣言カード('declaration')・裏面('back')を1コンポーネントで出し分ける。
// value=null（faceDown）の場合は variant に関わらず裏面を描画する。
export function PlayingCard({
  variant = "number", number, special,
  declaration, // "king" | "joker"（variant="declaration"用。勝者総取り/敗者総取りの払い出し方向を表す）
  faceDown = false, theme = "classic", width = 96,
  rarityGlow, // 裏面のエンブレム/枠をこの色で光らせる（報酬ボックスの開封演出専用、未指定時は通常の裏面と同じ見た目）
}) {
  const uid = useId().replace(/[:]/g, "");
  const t = CARD_THEMES[theme] || CARD_THEMES.classic;
  const height = width * (H / W);
  const isQueen = variant === "number" && special === "king";
  const glyphSize = isQueen ? 118 : (ROMAN_SIZE[number] ?? 118);
  const frameColor = isQueen ? QUEEN_COLOR
    : declaration === "king" ? "#4ade80" : declaration === "joker" ? "#f87171" : t.frame;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <radialGradient id={`bg-${uid}`} cx="50%" cy="38%" r="75%">
          <stop offset="0%" stopColor={t.bgFrom} />
          <stop offset="100%" stopColor={t.bgTo} />
        </radialGradient>
        <filter id={`grain-${uid}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.04 0" />
        </filter>
        <pattern id={`stripe-${uid}`} width="10" height="10" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="10" stroke={frameColor} strokeWidth="1" opacity="0.08" />
        </pattern>
      </defs>

      {/* 背景 */}
      <rect x="6" y="6" width={W - 12} height={H - 12} rx="16" fill={faceDown ? "#0a0a12" : `url(#bg-${uid})`} />
      {!faceDown && <rect x="6" y="6" width={W - 12} height={H - 12} rx="16" fill={`url(#grain-${uid})`} />}
      {!faceDown && variant === "declaration" && (
        <rect x="15" y="15" width={W - 30} height={H - 30} rx="11" fill={`url(#stripe-${uid})`} />
      )}

      <DoubleFrame color={faceDown ? (rarityGlow || "#33334a") : frameColor} filterId={!faceDown || !!rarityGlow} />
      {!faceDown && <CornerOrnaments color={frameColor} elaborate={isQueen || variant === "declaration"} />}

      {faceDown ? (
        // 裏面：六角形の幾何学エンブレム＋薄いグロー。rarityGlow指定時は報酬のレア度色で光らせる
        // （通常のゲーム内伏せ札はrarityGlow未指定のため、この変更で見た目は一切変わらない）。
        <g transform={`translate(${W / 2},${H / 2})`} style={rarityGlow ? { filter: `drop-shadow(0 0 8px ${rarityGlow})` } : undefined}>
          <polygon points="0,-38 33,-19 33,19 0,38 -33,19 -33,-19" fill="none" stroke={rarityGlow || "#4a4a66"} strokeWidth="2" />
          <polygon points="0,-22 19,-11 19,11 0,22 -19,11 -19,-11" fill="none" stroke={rarityGlow || "#4a4a66"} strokeWidth="1.2" opacity="0.7" />
        </g>
      ) : variant === "declaration" ? (
        // 宣言カード：上下対称(ダブルヘッド)レイアウトでKing(王冠)/Joker(ジェスター帽)を差し込む
        <>
          <g transform={`translate(${W / 2},128)`} style={{ filter: `drop-shadow(0 0 8px ${frameColor})` }}>
            <DeclEmblem kind={declaration} color={frameColor} />
          </g>
          <g transform={`translate(${W / 2},${H - 128}) rotate(180)`} style={{ filter: `drop-shadow(0 0 8px ${frameColor})` }}>
            <DeclEmblem kind={declaration} color={frameColor} />
          </g>
          {/* **書体は style で渡すこと。** SVGのpresentation attributeに var() を書いても
              解決されず、指定が丸ごと無効になって総称sans-serifへ落ちる。 */}
          <text x={W / 2} y={H / 2 + 8} textAnchor="middle" style={{ fontFamily: DISPLAY_FONT }} fontWeight="900"
            fontSize="20" letterSpacing="2" fill={frameColor}>{declaration === "king" ? "KING" : "JOKER"}</text>
        </>
      ) : (
        // 数字カード。Queenは数字の代わりに"Q"を表示する（旧仕様は金色に染めるだけだったが、
        // 極小サイズでの視認性・将来の3Dモデル差し替えを見据えて記号自体で示す形に変更した）。
        <>
          {/* **グリフの横幅で字の大きさを決めること。** ローマ数字は文字数がまちまちで、
              "VIII"(4文字)を"I"と同じ大きさで組むとカードの左右にはみ出す。viewBoxの幅(250)に対して
              左右に余白を残せる上限から逆算する。textLengthを使わないのは、字間だけが潰れて
              字面が崩れるため。**書体を替えたら必ずこの表も引き直すこと**——字の幅が変わるので、
              前の書体のために測った値は狭すぎ（＝無駄に小さい）か広すぎ（＝はみ出す）のどちらかになる。 */}
          <text x={W / 2} y={H / 2 + glyphSize * CAP_CENTER} textAnchor="middle" fontWeight="900"
            fontSize={glyphSize}
            fill={isQueen ? QUEEN_COLOR : (t.glyph || "#f0f0f5")}
            style={{ fontFamily: DISPLAY_FONT, ...(isQueen ? { filter: `drop-shadow(0 0 10px ${QUEEN_COLOR})` } : null) }}>
            {isQueen ? "Q" : NUMBER_ROMAN[number]}
          </text>
          {isQueen && (
            <g transform={`translate(${W - 34},34) scale(1.3)`} style={{ filter: `drop-shadow(0 0 6px ${QUEEN_COLOR})` }}>
              <QueenEmblem color={QUEEN_COLOR} />
            </g>
          )}
        </>
      )}
    </svg>
  );
}

function DeclEmblem({ kind, color }) {
  if (kind === "king") {
    // King：シンプルな王冠の幾何学線画
    return (
      <path d="M-20 10h40l-4-20-10 8-6-14-6 14-10-8-4 20z" fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
    );
  }
  // Joker：ジェスター帽（3つの尖り+先端の丸）の幾何学線画
  return (
    <g fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
      <path d="M-20 12c0-16 8-24 8-24l4 10 8-14 8 14 4-10s8 8 8 24z" />
      <circle cx="-12" cy="-14" r="2.6" fill={color} stroke="none" />
      <circle cx="0" cy="-20" r="2.6" fill={color} stroke="none" />
      <circle cx="12" cy="-14" r="2.6" fill={color} stroke="none" />
    </g>
  );
}

function QueenEmblem({ color }) {
  return (
    <g fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round">
      <path d="M-9 8c0-9 5-14 9-14s9 5 9 14" />
      <circle cx="0" cy="-8" r="2.6" fill={color} stroke="none" />
      <line x1="-9" y1="8" x2="9" y2="8" />
    </g>
  );
}

export const CHIP_TIER = {
  gain: { body: "#F2C230", ring: "#7a5c00", spot: "#fff6cf" },
  bonus: { body: "#FF8C32", ring: "#7a3a00", spot: "#ffe0bf" },
  loss: { body: "#FF4D4D", ring: "#6e0000", spot: "#ffd6d6" },
};
export function ChipToken({ tier = "gain", size = 20 }) {
  const uid = useId().replace(/[:]/g, "");
  const c = CHIP_TIER[tier] || CHIP_TIER.gain;
  const r = 16;
  const spots = Array.from({ length: 10 }, (_, i) => i * 36);
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <radialGradient id={`chip-${uid}`} cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor={c.spot} />
          <stop offset="55%" stopColor={c.body} />
          <stop offset="100%" stopColor={c.ring} />
        </radialGradient>
      </defs>
      <g transform="translate(20,20)">
        {spots.map((deg, i) => (
          <rect key={i} x="-2" y={-r - 1} width="4" height="5" rx="1" fill={c.spot}
            transform={`rotate(${deg})`} opacity="0.85" />
        ))}
        <circle r={r} fill={`url(#chip-${uid})`} stroke={c.ring} strokeWidth="1.5" />
        <circle r={r - 5} fill="none" stroke={c.ring} strokeWidth="1" opacity="0.6" />
      </g>
    </svg>
  );
}
