// 🔒 未解放/未所持を表す施錠アイコン。ConstructionIcon(開発中=未実装の機能)とは意味を分ける:
// こちらは「機能自体はあるが、まだ手に入れていない」ショップ・ボックスの品物と実績の状態表示専用。
export default function LockIcon({ size = 24, ...props }) {
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
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
