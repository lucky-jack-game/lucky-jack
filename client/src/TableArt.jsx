// バトルテーブル（賭け卓）のスキンテーマ定義＋プレビュー用スウォッチ。
// CardArt.jsxのCARD_THEMES（label/rarity/色情報という構造）に揃え、レアリティ段階も
// common/rare/epic/legendaryを踏襲する（ショップの価格・ボックスの中身から参照する単一の情報源）。
// イラスト制作パイプラインが無いため、CardArt.jsxと同様にSVG線画+グラデーションのみで構成する。
import { useId } from "react";

// `three`フィールドは同じ卓スキンの3D版パレット（three/tableSvgBuilders.jsが押し出す3層の色）。
// CARD_THEMESと同じ理由で2D/3Dの定義を分けない（詳細はCardArt.jsxの同名コメント参照）。
//   rail : 卓の外周レール（木部・最も暗い）  trim: レールとフェルトの間の金属トリム
//   felt : フェルト面（布の質感、光沢なし）  ＝2Dの`inner`と同値にして卓の色味を一致させる
// SlotMarker(three/SlotMarker.jsx)の目印もこのtrim/feltを使うため、卓の色を変えると
// カードを置く位置の目印も一緒に追従する。
export const TABLE_THEMES = {
  classic: {
    label: "クラシックグリーンフェルト", rarity: "common",
    inner: "#123322", outer: "#0f0f18",
    accent: "rgba(255,215,0,0.06)", rim: "rgba(255,215,0,0.22)", glow: "rgba(255,215,0,0.10)",
    three: { rail: "#1c0f08", trim: "#b8923f", felt: "#0f3d2e" },
  },
  neonCyan: {
    label: "ネオンブルーVIP卓", rarity: "rare",
    inner: "#0a2c3a", outer: "#05080a",
    accent: "rgba(34,229,255,0.10)", rim: "rgba(34,229,255,0.45)", glow: "rgba(34,229,255,0.20)",
    three: { rail: "#08131a", trim: "#2f9fb8", felt: "#0a2c3a" },
  },
  emerald: {
    label: "エメラルドラグジュアリー卓", rarity: "rare",
    inner: "#0a3626", outer: "#05080a",
    accent: "rgba(47,255,168,0.09)", rim: "rgba(47,255,168,0.4)", glow: "rgba(47,255,168,0.18)",
    three: { rail: "#06150f", trim: "#2aa877", felt: "#0a3626" },
  },
  crimsonVIP: {
    label: "クリムゾンハイローラー卓", rarity: "epic",
    inner: "#380a18", outer: "#08080d",
    accent: "rgba(255,47,110,0.10)", rim: "rgba(255,47,110,0.45)", glow: "rgba(255,47,110,0.20)",
    three: { rail: "#180608", trim: "#b8355e", felt: "#380a18" },
  },
  voidPurple: {
    label: "ヴォイドパープル卓", rarity: "legendary",
    inner: "#260f3f", outer: "#08080d",
    accent: "rgba(176,107,255,0.12)", rim: "rgba(176,107,255,0.5)", glow: "rgba(176,107,255,0.25)",
    three: { rail: "#0e0716", trim: "#7a4bc4", felt: "#260f3f" },
  },
  // ── 2色構成の卓（CardArt.jsxの同名スキンと対になる）──
  // **卓は「木のレール・金属のトリム・布のフェルト」の3素材が読めることが要件。**
  // 上のneonCyan〜voidPurpleは rail/trim/felt が全て同じ色相の明暗違いで、家具ではなく
  // 「色を塗った板」に見えていた（classicだけが 焦茶の木 × アンティークゴールド × 緑のフェルト
  // という素材の違いを持っていた）。以降の卓は必ず3つを別の素材として決める。
  //
  // feltは対になるカードスキンの bgFrom と同値にして、卓とカードが同じ組であることを色で示す
  // （2Dのスウォッチと実物の色味を一致させる既存の作法でもある）。
  patinaCrimson: {
    label: "パティナクリムゾン卓", rarity: "rare",
    inner: "#3d0f1e", outer: "#08080d",
    accent: "rgba(89,162,141,0.11)", rim: "rgba(89,162,141,0.45)", glow: "rgba(89,162,141,0.2)",
    three: { rail: "#140a0c", trim: "#59a28d", felt: "#3d0f1e" },
  },
  copperJade: {
    label: "カッパージェイド卓", rarity: "rare",
    inner: "#0d3b34", outer: "#05100e",
    accent: "rgba(208,138,82,0.10)", rim: "rgba(208,138,82,0.45)", glow: "rgba(208,138,82,0.18)",
    three: { rail: "#1d0f07", trim: "#b9793f", felt: "#0d3b34" },
  },
  steelAmber: {
    label: "スチールアンバー卓", rarity: "epic",
    inner: "#4a2f06", outer: "#0d0803",
    accent: "rgba(159,176,192,0.11)", rim: "rgba(159,176,192,0.48)", glow: "rgba(159,176,192,0.2)",
    three: { rail: "#141416", trim: "#7196b8", felt: "#4a2f06" }, // 鋼は彩度が低いほど暖色の環境を拾って沈むので青寄りに
  },
  amethystGold: {
    label: "アメジストゴールド卓", rarity: "legendary",
    inner: "#2e1252", outer: "#0a0610",
    accent: "rgba(232,200,116,0.13)", rim: "rgba(232,200,116,0.55)", glow: "rgba(232,200,116,0.24)",
    three: { rail: "#120a1c", trim: "#d4b054", felt: "#2e1252" },
  },

  // ── ボックス限定（ショップには絶対に並ばない）──
  // 報酬ボックス（勝利／完封）からのみ出る。ショップの在庫表（cosmetics.js の SHOP_STOCK）
  // には絶対に載せないこと（CHIPで買えないことが価値の源泉のため）。
  laurel: {
    label: "ローレル卓", rarity: "epic",
    inner: "#2a2109", outer: "#0c0906",
    accent: "rgba(232,200,116,0.12)", rim: "rgba(232,200,116,0.5)", glow: "rgba(232,200,116,0.22)",
    three: { rail: "#14100a", trim: "#c9a75c", felt: "#2a2109" },
  },
  sovereign: {
    label: "ソヴリン卓", rarity: "legendary",
    inner: "#3a2c10", outer: "#0a0806",
    accent: "rgba(244,231,191,0.14)", rim: "rgba(244,231,191,0.6)", glow: "rgba(244,231,191,0.3)",
    three: { rail: "#12100b", trim: "#d9c890", felt: "#3a2c10" },
  },
};

// 3D卓のパレット解決。未知のテーマID・`three`未定義はclassicへフォールバックする
// （CardArt.jsxのgetCardPalette3D()と同じ理由）。
export function getTablePalette3D(themeId) {
  return (TABLE_THEMES[themeId] || TABLE_THEMES.classic).three || TABLE_THEMES.classic.three;
}

// .kj-felt-panel（index.css）にCSS変数として渡すインラインstyleオブジェクトを返す。
// BattleScreenChrome（shared.jsx）が装備中テーブルを読んでこれを対戦フィールドに適用する。
// CPU練習・オンライン対戦どちらもBattleScreenChrome経由のため、1箇所直せば両方に反映される。
export function getTableFeltVars(themeId) {
  const t = TABLE_THEMES[themeId] || TABLE_THEMES.classic;
  return {
    "--felt-inner": t.inner,
    "--felt-outer": t.outer,
    "--felt-accent": t.accent,
    "--felt-rim": t.rim,
    "--felt-glow": t.glow,
  };
}

// スキン/ショップ画面用のミニチュアプレビュー：卓の質感（フェルト+キルティング+縁の発光）を
// そのまま小さく再現する。対戦画面の背景と同じ色情報(TABLE_THEMES)を参照するので見た目がブレない。
export function TableThemeSwatch({ themeId = "classic", width = 96 }) {
  const uid = useId().replace(/[:]/g, "");
  const t = TABLE_THEMES[themeId] || TABLE_THEMES.classic;
  const height = width * 0.62;
  return (
    <svg viewBox="0 0 160 100" width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <radialGradient id={`felt-${uid}`} cx="50%" cy="28%" r="85%">
          <stop offset="0%" stopColor={t.inner} />
          <stop offset="100%" stopColor={t.outer} />
        </radialGradient>
        {/* キルティング風の斜めステッチ模様（豪華な卓の質感を写真素材無しで表現） */}
        <pattern id={`quilt-${uid}`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="14" stroke={t.rim} strokeWidth="0.6" opacity="0.3" />
        </pattern>
      </defs>
      <rect x="3" y="3" width="154" height="94" rx="18" fill={`url(#felt-${uid})`} />
      <rect x="3" y="3" width="154" height="94" rx="18" fill={`url(#quilt-${uid})`} />
      <rect x="3" y="3" width="154" height="94" rx="18" fill="none" stroke={t.rim} strokeWidth="2.5"
        style={{ filter: `drop-shadow(0 0 5px ${t.glow})` }} />
      <rect x="10" y="10" width="140" height="80" rx="13" fill="none" stroke={t.rim} strokeWidth="1" opacity="0.55" />
    </svg>
  );
}
