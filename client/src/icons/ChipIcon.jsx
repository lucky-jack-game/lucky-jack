// CHIP（オンライン対戦の永続通貨）の代替アイコン。ポーカーチップの縁の等間隔ノッチで
// CoinIcon（汎用の所持pt表示）・GemIcon（コスメ通貨）とシルエットを差別化する。
export default function ChipIcon({ size = 24, ...props }) {
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
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 3v3.5M12 17.5V21M21 12h-3.5M6.5 12H3M18.4 5.6l-2.5 2.5M8.1 15.9l-2.5 2.5M18.4 18.4l-2.5-2.5M8.1 8.1 5.6 5.6" />
    </svg>
  );
}
