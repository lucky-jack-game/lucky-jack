import { useId } from "react";

// ホーム画面のファサード頂部に掲げる紋章（エスカッシャン＝盾形）。
// リゾートホテルの外観の洗練を建築の言語に翻訳した際、
// ヴィクトリアン様式のリゾート建築が持つ「正面性の頂点に据えられる紋章／ペディメントの装飾」に
// あたる要素。イラスト制作パイプラインが無いため、幾何(盾・菱形・シェブロン)と金のグラデーションだけで
// 構成する。中の菱形＋シェブロン(V字)は、3Dカードのローマ数字グリフ(three/cardSvgBuilders.js)が
// 直線とV字のシェブロンだけで組まれているのと同じ造形言語に揃えてある。
export default function CrestIcon({ size = 64, ...props }) {
  // 同一ページに複数描画されてもgradientのid衝突が起きないようにする。
  const uid = useId().replace(/:/g, "");
  const gilt = `crest-gilt-${uid}`;
  const inner = `crest-inner-${uid}`;

  return (
    <svg viewBox="0 0 64 78" width={size} height={(size * 78) / 64} fill="none" {...props}>
      <defs>
        <linearGradient id={gilt} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fdf6e0" />
          <stop offset="34%" stopColor="#e8c874" />
          <stop offset="66%" stopColor="#b8923f" />
          <stop offset="100%" stopColor="#7d6026" />
        </linearGradient>
        <linearGradient id={inner} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#241a10" />
          <stop offset="100%" stopColor="#0c0906" />
        </linearGradient>
      </defs>

      {/* 頂華(フィニアル)：屋根の頂点に立つ小さな飾り */}
      <circle cx="32" cy="5.5" r="3.2" fill={`url(#${gilt})`} />
      <path d="M32 8.8 V12.5" stroke={`url(#${gilt})`} strokeWidth="1.6" strokeLinecap="round" />

      {/* 盾の本体 */}
      <path
        d="M32 12.5 L56 19.5 V39 C56 56 45 66 32 72.5 C19 66 8 56 8 39 V19.5 Z"
        fill={`url(#${inner})`}
        stroke={`url(#${gilt})`}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* 内側の細い縁取り（建築の二重トリムと同じ表現） */}
      <path
        d="M32 17.5 L51.5 23.2 V39 C51.5 52.5 42.5 61 32 66.6 C21.5 61 12.5 52.5 12.5 39 V23.2 Z"
        stroke={`url(#${gilt})`}
        strokeWidth="0.9"
        strokeOpacity="0.55"
        strokeLinejoin="round"
      />

      {/* 中央の菱形とシェブロン（カードのローマ数字グリフと同じ造形言語） */}
      <path d="M32 28 L41.5 41 L32 54 L22.5 41 Z" stroke={`url(#${gilt})`} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M26.5 43.5 L32 35.5 L37.5 43.5" stroke={`url(#${gilt})`} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
