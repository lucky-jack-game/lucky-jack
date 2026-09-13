// 🚧 開発中表示（DevOverlay "🚧" / ルームカードの "🚧 開発中" バッジ）の代替アイコン
export default function ConstructionIcon({ size = 24, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3" y="8" width="18" height="6" rx="1" />
      <line x1="5" y1="8" x2="9" y2="14" />
      <line x1="9" y1="8" x2="13" y2="14" />
      <line x1="13" y1="8" x2="17" y2="14" />
      <line x1="17" y1="8" x2="21" y2="14" />
      <line x1="6" y1="14" x2="6" y2="20" />
      <line x1="18" y1="14" x2="18" y2="20" />
    </svg>
  );
}
