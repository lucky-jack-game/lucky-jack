import { FONT, CHIP_GOLD } from "../shared.jsx";
import { getRankRp } from "../storage.js";
import { ONLINE_ENABLED } from "../features.js";
import { resolveRank } from "../rank.js";
import RankBadge from "../icons/RankBadge.jsx";
import ChipIcon from "../icons/ChipIcon.jsx";

// ヘッダー右上の自分の状態（名札と CHIP 残高）。どちらも表示だけで押せない。

// ヘッダー右上の名札。ロビーの名札をここへ移した（参考にした構成の「PLAYER」の位置）。
// 段位はバッジ単体にせず段位名を並べる（RankProgressPanel と同じ規則）。RPの進捗はキャリア画面の持ち物。
// **頭文字のメダイヨンは出さない**。アイコンを変える手段が
// 画面のどこにも無いので、「プ」のような既定名の頭文字が固定で出続けるだけになる
// ——変えられない物を自分の顔として置かない。
// **compact（モバイルのステータスバー）でも2行目（称号）を出す。** 以前は「バーを低く保つ」ために名前だけにしていたが、
// スマホでは称号を付けても自分の名前の下のどこにも出ず、称号を集めて付ける意味が画面から消えていた
// 。
// 字を小さくして高さを抑える（.kj-player-plate.compact .title）。
// **段位はオンラインのランクマッチでしか動かない**ので、オンラインを出さない提出版（features.js）では
// 段位の代わりに装備中の称号を添える（永遠に STONE のままの段位名を常に見せても何も伝わらない）。
export function PlayerPlate({ name, title, compact = false }) {
  const { tier } = resolveRank(getRankRp());
  const cls = `kj-player-plate${compact ? " compact" : ""}`;
  const inner = (
    <span className="kj-player-plate-text">
      <span className="name">{name}</span>
      {ONLINE_ENABLED ? (
        <span className="rank" style={{ color: tier.line }}>
          <RankBadge tier={tier.id} size={11} />{tier.label}
        </span>
      ) : title ? <span className="title">{title}</span> : null}
    </span>
  );
  // **button で描かないこと**。
  // onClick を外しただけの <button> はホバーも押し込みもフォーカスも残るので、
  // 「押せるように見えて何も起きない」という、無反応よりたちの悪い形になる。
  return <div className={cls}>{inner}</div>;
}

// ヘッダー（モバイルのステータスバー / PCの上部ナビ）に常駐する残高表示。表示だけで押せない（ショップへはナビから入る）。
export function WalletMiniBadges({ chips, size = 16 }) {
  // かつてここだけ本文書体を使っていた。前の見出し書体(Orbitron)の"0"が角ばった正方形で、
  // 隣にアイコンが並ぶ極小サイズだと数字なのかアイコンの一部なのか判別しづらかったため
  // （特に残高0のとき）。**書体を替えたのでその理由は消えた**ので、画面上の他の数字と揃える。
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      fontFamily: FONT.display, fontWeight: 700, fontVariantNumeric: "tabular-nums",
      fontSize: size - 3, color: CHIP_GOLD,
    }}>
      <ChipIcon size={size} /> {chips}
    </div>
  );
}
