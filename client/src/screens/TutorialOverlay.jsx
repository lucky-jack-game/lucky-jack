import { useState, useEffect } from "react";
import { outlineBtnStyle, goldBtnStyle, RAISE_PURPLE, PENALTY_RED, RADIUS, SURFACE, FONT, GILT, numeralStyle, CHIP_GOLD } from "../shared.jsx";
import { getEquippedSkin } from "../storage.js";
import { PlayingCard } from "../CardArt.jsx";

// ─── 初回チュートリアル（`TutorialOverlay`）───
//
// **`HowToPlayScreen`（遊び方・ルール）とは役割が違う。** あちらは設定の奥にある「後から
// 自分の意思で引く辞書」で、6項目の本文をまとめて置く場所。こちらは初回起動時に自動で出る
// 「最初の1周だけの案内」なので、要件が正反対になる:
//   ・**文章ではなく実物を見せる。** このゲームの規則はほぼ全てカードの絵で説明できる
//     （Ⅰ〜Ⅹの強弱・Ⅰの逆転・Queen・KING/JOKER）。テキストで書き下すと、初回にいちばん読まれない
//     形式でいちばん重要な情報を出すことになる。各ステップは必ず本物のカード(PlayingCard)を伴う。
//   ・**1画面に1つだけ。** 覚えるべきことが6つあるなら6画面に割る。遊び方画面のように
//     縦に積むと、初回起動でいきなりスクロールする壁が出てくる。
//   ・**いつでも抜けられる。** 右上にスキップを常設し、進捗ドットで残りが何枚かを常に示す。
// 見終えた／スキップしたことだけを`storage.js`の`isTutorialDone`に残し、再開位置は持たない。
// 設定画面からいつでも見直せる（`onOpenTutorial`）。
// 灯り（ライフ）を説明用に並べる小さな図。対戦画面の`LifeLights`と同じ意匠だが、
// あちらは対戦の状態に紐づく部品なので、説明用に静的な絵として最小限だけ描く。
function TutorialLifeRow({ total = 6, lit = 4 }) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} style={{
          width: 20, height: 20, borderRadius: "50%",
          background: i < lit
            ? `radial-gradient(circle at 35% 30%, #fff8e0, ${CHIP_GOLD} 55%, rgba(0,0,0,0.4) 100%)`
            : "rgba(255,255,255,0.05)",
          border: `1px solid ${i < lit ? CHIP_GOLD : "rgba(255,255,255,0.10)"}`,
          boxShadow: i < lit ? `0 0 12px ${CHIP_GOLD}` : "none",
        }} />
      ))}
    </div>
  );
}

// UP/DOWNの公表バッジ（説明用）。対戦画面の`BandBadge`と同じ読み方をさせる。
function TutorialBands({ up, down }) {
  const cell = (kind, n, fg, bg, br) => (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 5,
      background: bg, border: `1px solid ${br}`,
    }}>
      <span style={{ fontFamily: FONT.display, fontSize: 11, letterSpacing: "0.08em", color: fg }}>{kind}</span>
      <span style={numeralStyle(15, GILT.ivory, 800)}>{n}</span>
    </span>
  );
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
      {cell("UP", up, "#7FD6BC", "rgba(89,162,141,0.18)", "#59A28D")}
      {cell("DOWN", down, "#CFA6FF", "rgba(176,107,255,0.16)", "#B06BFF")}
    </div>
  );
}

// ─── ルール説明（初回起動で読む側）───
// **1分で1周できる量に収めること**。1回読めばゲームの流れと
// ルールがおおよそ掴める量にする。設計の約束は4つ:
//   1. **並びは1局の中で起きる順**（奪い合う物 → 札の強さ → 手札 → 相手に見える物 → 1局の流れ →
//      宣言 → 賭ける → アンティと上限）。規則の一覧として並べると、覚えた物を実際の手順に
//      組み立て直す作業が読み手に残る。
//   2. **1枚に1つ。本文は1〜2文**。理由（「だから〜」）は書かない——腑に落ちる瞬間は
//      実践チュートリアルで一度打った時に来るので、ここで説明しても読み飛ばされるだけ。
//   3. **呼び名を3箇所で揃える**（このスライド・実践チュートリアル・HowToPlayScreen）。
//      ライフ／宣言／KING・JOKER／UP・DOWN／賭ける・降りる。同じ物に別の名前が付くと、
//      読み手は別の物だと思う（「総取り」「払い出しの向き」「ポット」はこの理由で使わない）。
//   4. **実践チュートリアルと食い違う数字を書かない**（あちらは8ライフで回すので、
//      「お互い6ライフ」と書くと直後の画面が嘘に見える）。
const TUTORIAL_STEPS = [
  {
    title: "ライフを奪い合う",
    body: "相手のライフを 0 にするか、最後に多く残した方が勝ち。",
    art: () => <TutorialLifeRow total={6} lit={4} />,
  },
  {
    // 見出しのローマ数字は前後に空白を置くこと。"I"はどの書体でもただの縦棒で、
    // 日本語に詰めて置くと文字と文字の隙間に紛れて読み落とされる（実機で確認）。
    title: "大きい数字が勝つ",
    body: "ただし I だけは X に勝つ。",
    art: () => (
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
        <PlayingCard variant="number" number={3} width={46} theme={getEquippedSkin()} />
        <span style={{ fontSize: 15, color: SURFACE.textMuted }}>＜</span>
        <PlayingCard variant="number" number={8} width={46} theme={getEquippedSkin()} />
        <span style={{ width: 14 }} />
        <PlayingCard variant="number" number={1} width={46} theme={getEquippedSkin()} />
        <span style={{ fontSize: 15, color: GILT.bright }}>＞</span>
        <PlayingCard variant="number" number={10} width={46} theme={getEquippedSkin()} />
      </div>
    ),
  },
  {
    title: "Queen は I にだけ負ける",
    body: "ほかの札には必ず勝つ。1試合に1枚しか無い。",
    art: () => (
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
        <PlayingCard variant="number" number={10} width={52} theme={getEquippedSkin()} />
        <span style={{ fontSize: 15, color: SURFACE.textMuted }}>＜</span>
        <PlayingCard variant="number" number={10} special="king" width={52} theme={getEquippedSkin()} />
        <span style={{ fontSize: 15, color: GILT.bright }}>＜</span>
        <PlayingCard variant="number" number={1} width={52} theme={getEquippedSkin()} />
      </div>
    ),
  },
  {
    title: "手札は2枚。出すのは1枚",
    body: "出さなかった1枚は、次の局へ持ち越す。",
    art: () => (
      <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: "translateY(-8px)", outline: "2px solid " + CHIP_GOLD, outlineOffset: 3, borderRadius: 6 }}>
          <PlayingCard variant="number" number={9} width={58} theme={getEquippedSkin()} />
        </div>
        <div style={{ filter: "grayscale(0.5) brightness(0.6)" }}>
          <PlayingCard variant="number" number={2} width={58} theme={getEquippedSkin()} />
        </div>
      </div>
    ),
  },
  {
    // **Queen が DOWN に並ぶことは、UP/DOWN の定義と同じ1文で言い切る**（以前は別の1枚にしていた）。
    // 切り離すと、定義を読んだ時点で「DOWN＝弱い札」と覚えてしまい、次の1枚で訂正させることになる。
    title: "相手に見えるのは UP と DOWN",
    body: "VI〜X は UP。I〜V と Queen は DOWN。",
    art: () => <TutorialBands up={1} down={1} />,
  },
  {
    // ゲームの流れはこの1枚で渡す。**本文は絵の言い直しにしないこと**——手順は絵が出しているので、
    // 本文はそこに無い1つ＝誰が宣言するのかだけを言う。
    title: "1局の流れ",
    body: "宣言するのは、前の局でライフを失った側。",
    art: () => (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
        {["宣言", "札を出す", "賭ける", "開く"].map((label, i) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <span style={{ color: SURFACE.textMuted, fontSize: 12 }}>→</span>}
            <span style={{
              padding: "8px 10px", borderRadius: RADIUS.sm, fontSize: 12,
              border: "1px solid " + GILT.dim, color: GILT.ivory, background: "rgba(232,200,116,0.08)",
            }}>{label}</span>
          </span>
        ))}
      </div>
    ),
  },
  {
    title: "宣言は KING か JOKER",
    body: "KING は札で勝った方、JOKER は負けた方がライフを取る。",
    art: () => (
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <PlayingCard variant="declaration" declaration="king" width={62} theme={getEquippedSkin()} />
        <PlayingCard variant="declaration" declaration="joker" width={62} theme={getEquippedSkin()} />
      </div>
    ),
  },
  {
    title: "賭ける・降りる",
    body: "札は伏せたまま賭け合う。降りれば、賭けた分は相手に渡る。",
    art: () => (
      <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
        {[["フォールド", PENALTY_RED], ["コール", "#4ade80"], ["レイズ", RAISE_PURPLE]].map(([label, color]) => (
          <div key={label} style={{
            padding: "10px 12px", borderRadius: RADIUS.sm, fontSize: 12,
            border: "1px solid " + color, color, background: color + "14",
          }}>{label}</div>
        ))}
      </div>
    ),
  },
  {
    // **アンティだけは名前を渡す**——対戦画面のヘッダーに「アンティ 3」と出る語なので、
    // ここで聞いていないと、本番で初めて出た語が何かを確かめる手段が画面に無い。
    // **1局の上限の数字は書かない**（実践チュートリアルは8ライフで回すので、本番の「5」と食い違う）。
    // **「1局では必ず1ライフ残る」とも書かないこと**——拠出は少ない方の残りライフでも切られるので、
    // 残り2ライフなら1局で両方失いうる。言い切った瞬間に嘘になる。
    title: "アンティと上限",
    body: "毎局まず 1 ずつ賭ける。最終局だけ 3。1局に賭けられる額には上限がある。",
    art: () => (
      <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: SURFACE.textMuted, marginBottom: 6 }}>いつもの局</div>
          <TutorialLifeRow total={3} lit={1} />
        </div>
        <span style={{ fontSize: 16, color: GILT.bright }}>→</span>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: GILT.bright, marginBottom: 6 }}>最終局</div>
          <TutorialLifeRow total={3} lit={3} />
        </div>
      </div>
    ),
  },
];

export function TutorialOverlay({ onClose, onFinish }) {
  const [step, setStep] = useState(0);
  const s = TUTORIAL_STEPS[step];
  const last = step === TUTORIAL_STEPS.length - 1;
  // 最後まで読んだら実践チュートリアルへ繋ぐ（onFinish）。スキップ・「あとで」はonCloseで閉じるだけ。
  const next = () => (last ? (onFinish || onClose)() : setStep((i) => i + 1));
  // Enter/Space/→ で進める（キーボード操作の既存の作法に揃える。keybinds.jsのSkipKeysと同じ考え方）
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat) return;
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setStep((i) => Math.max(0, i - 1)); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 90, background: "rgba(6,5,4,0.985)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "24px 20px", fontFamily: "var(--font-body)",
    }}>
      <button onClick={onClose} className="kj-pressable" style={{
        position: "absolute", top: 16, right: 16, background: "transparent",
        border: `1px solid ${SURFACE.hairlineStrong}`, borderRadius: RADIUS.sm,
        padding: "6px 12px", color: SURFACE.textMuted, fontSize: 12, cursor: "pointer",
      }}>スキップ</button>

      <div style={{ width: "100%", maxWidth: 380, textAlign: "center" }}>
        <div style={{ minHeight: 116, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 22 }}>
          {s.art()}
        </div>
        <div style={{
          fontFamily: "var(--font-display)",
          fontSize: 17, color: GILT.bright, marginBottom: 10,
        }}>{s.title}</div>
        <div style={{ fontSize: 13, color: "#cfc3ae", lineHeight: 1.8, minHeight: 68 }}>{s.body}</div>

        {/* 進捗ドット。残りが何枚あるか分からないまま送らせない（途中で降りる理由になる） */}
        <div style={{ display: "flex", gap: 6, justifyContent: "center", margin: "22px 0 18px" }}>
          {TUTORIAL_STEPS.map((_, i) => (
            <span key={i} style={{
              width: i === step ? 18 : 6, height: 6, borderRadius: 3,
              background: i === step ? GILT.bright : SURFACE.hairlineStrong,
              transition: "width 0.2s ease, background 0.2s ease",
            }} />
          ))}
        </div>

        {/* 最後は「実際に打ってみる」へ繋ぐ。ルール説明は読んで分かる形、実践チュートリアルは
            本物の対戦画面で打つ形——**初回はこの順に通すのが自然**（読む→やる）で、
            どちらも設定画面から個別に開き直せる。 */}
        {/* **戻れるようにすること**。1画面に1つずつ送る作りなので、
            読み落としても前へ戻す手段が画面に無いと、最初からやり直すしかなくなる。
            キーの ← は元から効いていたが、押せる物が出ていなければ誰も気付けない。
            1枚目では出さず（戻る先が無い）、幅を取って「次へ」の位置は動かさない。 */}
        <div style={{ display: "flex", gap: 8 }}>
          {step > 0 && (
            <button onClick={() => setStep((i) => Math.max(0, i - 1))} className="kj-pressable"
              style={{ ...outlineBtnStyle(), width: 96, padding: "13px 0", flexShrink: 0 }}>戻る</button>
          )}
          <button onClick={next} className="kj-pressable" style={{ ...goldBtnStyle(), flex: 1, padding: "13px 0" }}>
            {last ? "実際に打ってみる" : "次へ"}
          </button>
        </div>
        {last && (
          <button onClick={onClose} className="kj-pressable" style={{
            ...outlineBtnStyle(), width: "100%", padding: "10px 0", marginTop: 8, fontSize: 12,
          }}>あとで（ホームへ）</button>
        )}
      </div>
    </div>
  );
}
