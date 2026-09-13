// ⚡ クイックマッチ・VS演出・ランキングバッジ（"⚡" 直書き, MOCK_RANKINGS badge, "⚡ VS ⚡", "⚡ MATCH ⚡" など）の代替アイコン
export default function LightningIcon({ size = 24, ...props }) {
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
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}
