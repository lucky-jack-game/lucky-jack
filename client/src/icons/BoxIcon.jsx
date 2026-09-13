// 報酬ボックス（勝利ボックス／完封ボックス）のアイコン。リボンを掛けた宝箱風の直方体。
// ショップの商品（買える）と、勝ってしか手に入らないボックスを一目で区別させるための専用意匠。
export default function BoxIcon({ size = 24, ...props }) {
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
      {/* 蓋 */}
      <rect x="2.6" y="6.2" width="18.8" height="4.6" rx="1.2" />
      {/* 本体 */}
      <path d="M4.4 10.8 V19.4 a1 1 0 0 0 1 1 h13.2 a1 1 0 0 0 1 -1 V10.8" />
      {/* リボン（縦） */}
      <path d="M12 6.2 V20.4" />
      {/* リボンの結び目 */}
      <path d="M12 6.2 C 10.6 3.2, 7.4 3.2, 8.2 5.2 C 8.7 6.4, 10.6 6.2, 12 6.2 Z" />
      <path d="M12 6.2 C 13.4 3.2, 16.6 3.2, 15.8 5.2 C 15.3 6.4, 13.4 6.2, 12 6.2 Z" />
    </svg>
  );
}
