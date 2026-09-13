// ショップタブのアイコン。日除け(オーニング)付きの店構え。
// ホーム画面のファサードと同じ「建築」の語彙で描き、カプセルトイのアイコン(CapsuleIcon)が
// 持っていた「ランダムに引く」という含意を持たせない——ショップは狙って買う場所なので。
export default function ShopIcon({ size = 24, ...props }) {
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
      {/* 日除け */}
      <path d="M3 8.5 L4.6 4.5 h14.8 L21 8.5 Z" />
      <path d="M3 8.5 h18" />
      {/* 店舗本体 */}
      <path d="M4.8 8.5 V20 h14.4 V8.5" />
      {/* 扉 */}
      <path d="M9.8 20 v-6 h4.4 v6" />
    </svg>
  );
}
