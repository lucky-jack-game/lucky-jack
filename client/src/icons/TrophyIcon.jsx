// 🏆 ランキング画面見出し（HomeScreen "🏆 ランキング"）の代替アイコン
export default function TrophyIcon({ size = 24, ...props }) {
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
      <path d="M8 4h8v4a4 4 0 0 1-8 0V4z" />
      <path d="M8 5H5a3 3 0 0 0 3 5" />
      <path d="M16 5h3a3 3 0 0 1-3 5" />
      <line x1="12" y1="12" x2="12" y2="17" />
      <path d="M8 20h8" />
      <line x1="12" y1="17" x2="12" y2="20" />
    </svg>
  );
}
