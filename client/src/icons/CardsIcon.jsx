// 「デッキ」導線用のカードの束アイコン。
// 以前は SwordsIcon（交差した2本の剣）を流用していたが、16〜20pxまで小さくすると
// ただの「✕」に見えてしまい、閉じる/削除の意味に読めてしまっていた（実際に見て判明）。
// 重なった2枚のカードという、機能そのものを指す形に差し替える。
export default function CardsIcon({ size = 24, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* 後ろの1枚（少し傾けて束であることを示す） */}
      <rect x="3.2" y="6.4" width="10" height="14" rx="2" transform="rotate(-14 8.2 13.4)" />
      {/* 手前の1枚 */}
      <rect x="10.5" y="4" width="10.5" height="15" rx="2" />
      {/* 手前の札の中心マーク（数字カードのローマ数字を想起させる縦棒） */}
      <line x1="15.75" y1="9.5" x2="15.75" y2="13.5" />
    </svg>
  );
}
