// 段位バッジ（STONE〜MONARCH）。ランクごとに別ファイルを8枚作るのではなく、
// rank.jsのRANK_TIERSが持つ金属の色と刻みの数だけを差し替える1つの紋章にしてある
// （8枚に分けると、後で形を直すときに8箇所を揃えて直すことになり必ずズレる）。
//
// 形はホーム画面の紋章(CrestIcon)と同じ「盾」に寄せ、画面をまたいで同じ紋章体系に見えるようにする。
// 段位の識別は ①金属の色 ②盾の中の刻みの本数 の2つで行い、MONARCHだけ盾の上に王冠が載る。
// バッジ単体で段位名まで読ませようとはしない——実際の表示では必ずラベルを併記する。
import { useId } from "react";
import { RANK_BY_ID, RANK_TIERS } from "../rank.js";

export default function RankBadge({ tier = "stone", size = 28, ...props }) {
  const uid = useId().replace(/[:]/g, "");
  const t = RANK_BY_ID[tier] || RANK_TIERS[0];
  const marks = Math.max(1, Math.min(4, t.marks));

  return (
    <svg viewBox="0 0 48 56" width={size} height={size * (56 / 48)} style={{ display: "block", overflow: "visible" }} {...props}>
      <defs>
        <linearGradient id={`rk-${uid}`} x1="18%" y1="0%" x2="82%" y2="100%">
          <stop offset="0%" stopColor={t.from} />
          <stop offset="52%" stopColor={t.to} />
          <stop offset="100%" stopColor={t.from} stopOpacity="0.75" />
        </linearGradient>
        {/* 盾の上半分に走らせる面のハイライト（金属の板であることを示す） */}
        <linearGradient id={`rkg-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.34" />
          <stop offset="46%" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      {t.crown && (
        // MONARCHのみ：盾の上に載る王冠。席数で決まる唯一の段位なので、形そのものを別格にする
        <path
          d="M12.5 12.5 V5.6 L18.6 9.8 L24 3.6 L29.4 9.8 L35.5 5.6 V12.5 Z"
          fill={t.line}
          stroke={t.line}
          strokeWidth="1.1"
          strokeLinejoin="round"
          style={{ filter: `drop-shadow(0 0 4px ${t.line})` }}
        />
      )}

      {/* 盾（下端が尖ったヒーターシールド） */}
      <path
        d="M24 12 L41 17.5 V32 C41 41.5 33.5 47.5 24 51.5 C14.5 47.5 7 41.5 7 32 V17.5 Z"
        fill={`url(#rk-${uid})`}
        stroke={t.line}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M24 12 L41 17.5 V32 C41 41.5 33.5 47.5 24 51.5 C14.5 47.5 7 41.5 7 32 V17.5 Z"
        fill={`url(#rkg-${uid})`}
      />
      {/* 内側の縁取り（VIPカードの二重フレームと同じ手法で「彫り」を出す） */}
      <path
        d="M24 16.5 L37 20.7 V31.6 C37 39 31.2 43.8 24 47 C16.8 43.8 11 39 11 31.6 V20.7 Z"
        fill="none"
        stroke={t.line}
        strokeWidth="0.9"
        strokeOpacity="0.55"
      />

      {/* 段位の刻み（山形）。色だけでは隣り合う段の区別が付きにくいので本数でも差を付ける */}
      {Array.from({ length: marks }, (_, i) => (
        <path
          key={i}
          d={`M16.8 ${40 - i * 5.2} L24 ${35.2 - i * 5.2} L31.2 ${40 - i * 5.2}`}
          fill="none"
          stroke={t.line}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.95 - i * 0.06}
        />
      ))}
    </svg>
  );
}
