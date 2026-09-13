// 🔥 勝ち宣言・連勝ボーナス（STAMPS "win" / DECL_DISPLAY.win / PointChip kind="bonus" / ランキングバッジなど）の代替アイコン
export default function FireIcon({ size = 24, ...props }) {
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
      <path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c0-1-1-2-1-3 2 1 4 3 4 6a6 6 0 0 1-12 0c0-5 4-6 6-11z" />
    </svg>
  );
}
