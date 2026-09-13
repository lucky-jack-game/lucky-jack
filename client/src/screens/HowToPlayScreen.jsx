import { RADIUS, SURFACE } from "../shared.jsx";
import { ONLINE_ENABLED } from "../features.js";
import BulbIcon from "../icons/BulbIcon.jsx";
import CardsIcon from "../icons/CardsIcon.jsx";
import ChevronLeftIcon from "../icons/ChevronLeftIcon.jsx";



// 遊び方・ルール参照画面：設定画面からいつでも呼び出せる（初回に自動では出さない、
// 後から自分の意思で確認しに来る場所）。
// **規則は1行ずつ並べる。散文で書かない。** ここは後から引く辞書なので、読み物ではなく
// 一覧であることの方が役に立つ。「つまり」「〜になる」で言い直したり、なぜその規則があるかを
// 説明したりしないこと——引きに来た人が探しているのは結論の1行だけ。
export function HowToPlayScreen({ onBack, onReplayTutorial }) {
  const sections = [
    // 呼び名はルール説明のスライド・実践チュートリアルと揃える（TUTORIAL_STEPS の冒頭の約束3）。
    // ここは辞書なので、スライドに書かない数字（ライフ数・上限）はこちらが持つ。
    {
      title: "勝敗", lines: [
        "一対一でライフを奪い合う。先に 0 になった方の負け。",
        "最終局まで決着しなければ、ライフの多い方の勝ち。同数ならサドンデスで1局延長する。",
        // ランクマッチはオンラインにしか無いので、出さない版では書かない（features.js）
        ONLINE_ENABLED ? "カジュアル 6ライフ・8局 ／ ランク 7ライフ・15局。" : "6ライフ・8局。",
      ],
    },
    {
      title: "札の強さ", lines: [
        "I〜X は大きい方が勝つ。",
        "ただし I だけは X に勝つ。",
        "Queen は I 以外のすべてに勝つ。1試合に1枚しか無い。",
        "同じ数字なら、宣言した側が勝つ。",
      ],
    },
    {
      title: "手札と公表", lines: [
        "手札は2枚。出すのは1枚。出さなかった1枚は次の局へ持ち越す。",
        "相手に見えるのは、手札の UP と DOWN の枚数だけ。",
        "VI〜X が UP。I〜V と Queen が DOWN。",
      ],
    },
    {
      title: "1局の流れ", lines: [
        "宣言 → 札を出す → 賭ける → 開く。",
        "宣言するのは、前の局でライフを失った側。KING か JOKER を選ぶ。",
        "KING は札で勝った方、JOKER は負けた方がライフを取る。",
        "宣言しなかった側から先に賭ける。",
      ],
    },
    {
      title: "賭け", lines: [
        // 最終局のアンティを3にした時（shared/engine.js の ANTE_TAIL）にここだけ直し漏れていた。
        "アンティ：毎局まず 1 ずつ賭ける。最終局だけ 3。",
        "続けてレイズ・コール・フォールドで賭け合う。",
        ONLINE_ENABLED
          ? "1局に賭けられる上限：カジュアル 5 ／ ランク 6。"
          : "1局に賭けられるのは 5 まで。",
        "持っていない分は賭けられない。",
        "降りたら、それまでに賭けた分を失う。",
        "降りた局でも、最後に両者の札を公開する。",
      ],
    },
    {
      title: "札の配り方", lines: [
        "I〜X を各12枚まぜ、半分を捨ててから配る。",
        "残りの中身は最後まで分からない。Queen はその中に1枚だけ。",
      ],
    },
  ];
  return (
    <div style={{ height: "100%", overflowY: "auto", background: "#0b0806" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 16px 0" }}>
        <button onClick={onBack} className="kj-pressable" aria-label="戻る" style={{
          background: SURFACE.card, border: "none", borderRadius: RADIUS.sm,
          width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          color: "#f4e7bf", cursor: "pointer", flexShrink: 0,
        }}><ChevronLeftIcon size={18} /></button>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "#e8c874", display: "flex", alignItems: "center", gap: 8 }}>
          <BulbIcon size={20} /> 遊び方・ルール
        </div>
      </div>
      <div className="kj-page-scroll">
        {sections.map((s, i) => (
          <div key={i} style={{ background: SURFACE.card, borderRadius: RADIUS.md, padding: 16, marginBottom: 12 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 14, color: "#e8c874", marginBottom: 8 }}>{s.title}</div>
            {/* ここは読ませる本文なので、文字を選択できる側に置く（index.css の .kj-selectable）。 */}
            {s.lines.map((line, j) => (
              <div key={j} className="kj-selectable" style={{ fontSize: 13, color: "#cfc3ae", lineHeight: 1.7, marginTop: j ? 3 : 0 }}>{line}</div>
            ))}
          </div>
        ))}
        {/* カードの絵で見せる案内への入口。**設定画面に3つ並べず、読む側の入口はここへ集約する**
            。辞書を引きに来て「やっぱり最初から見たい」となる順路なので、
            この画面の末尾が置き場所として素直。 */}
        {onReplayTutorial && (
          <button onClick={onReplayTutorial} className="kj-pressable" style={{
            width: "100%", padding: "12px 0", borderRadius: RADIUS.sm,
            border: `1px solid ${SURFACE.hairlineStrong}`, background: "transparent",
            color: "#f4e7bf", cursor: "pointer", fontSize: 14, marginBottom: 12,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}><CardsIcon size={16} style={{ color: "#e8c874" }} /> ルール説明をもう一度見る</button>
        )}
      </div>
    </div>
  );
}
