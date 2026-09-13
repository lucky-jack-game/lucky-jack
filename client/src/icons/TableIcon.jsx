// テーブル（賭け卓スキン）タブの代替アイコン：カジノの卓を真上から見た楕円+縁取り
export default function TableIcon({ size = 24, ...props }) {
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
      <ellipse cx="12" cy="12" rx="9" ry="6" />
      <ellipse cx="12" cy="12" rx="5.5" ry="3.2" />
      <path d="M3 12v3c0 1 4 2 9 2s9-1 9-2v-3" opacity="0.6" />
    </svg>
  );
}
