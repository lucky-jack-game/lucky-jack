// 🏅 プロフィールの称号表示（ProfileScreen "🏅 {profile.title}"）の代替アイコン
export default function MedalIcon({ size = 24, ...props }) {
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
      <path d="M9 10.5 7 3h3l1.5 4.5" />
      <path d="M15 10.5 17 3h-3l-1.5 4.5" />
      <circle cx="12" cy="15" r="5" />
      <path d="M12 12.5 12.9 14.3 15 14.6 13.5 16 13.9 18 12 17 10.1 18 10.5 16 9 14.6 11.1 14.3 12 12.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
