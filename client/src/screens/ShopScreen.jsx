import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { createPortal } from "react-dom";
import { PENALTY_RED, RADIUS, SURFACE } from "../shared.jsx";
import { playClick, playCardFlip, playWin, playCoin, playNotify, playBoxOpen } from "../audio/sfx.js";
import { getSettings, getChips, addChips, getEquippedSkin, getShopSeed, getShopEpoch, getShopNextRotationTs, getShopSoldIds, markShopSold, getBoxes, consumeBox, BOX_TYPES } from "../storage.js";
import { mulberry32 } from "../../../shared/engine.js";
// 在庫表と抽選は**JSXを含まないファイル**に置いてある（cosmetics.js の冒頭の注意書き参照）。
import { COSMETIC_TITLES, COSMETIC_OWNERSHIP, SHOP_STOCK, SHOP_PRICE, SHOP_SLOTS, boxPool, rollBoxReward } from "../cosmetics.js";
import { PlayingCard, CARD_THEMES, RARITY_COLOR } from "../CardArt.jsx";
import { TABLE_THEMES, TableThemeSwatch } from "../TableArt.jsx";
import MedalIcon from "../icons/MedalIcon.jsx";
import ChipIcon from "../icons/ChipIcon.jsx";
import ShopIcon from "../icons/ShopIcon.jsx";
import BoxIcon from "../icons/BoxIcon.jsx";
import { CardShowcase3D, TableShowcase3D } from "./showcase3dLazy.js";

// ─── ショップ／報酬ボックス（旧ガチャの置き換え） ───
//
// ガチャ（通貨を払ってランダムに引く）は廃止した。代わりに入手経路を2つに割り、
// 「買って手に入るもの」と「勝ってしか手に入らないもの」を完全に分離する:
//
//   ショップ … CHIPで“狙って”買う。1時間ごとに品揃えが入れ替わり、品揃えはプレイヤーごとに違う。
//              ランダム性は「今その棚に並んでいるか」だけに寄せ、支払った対価が外れになることは無い。
//   ボックス … 勝利（勝てば毎回）と完封（ライフを1つも失わずに勝つ）でのみ入手。
//              中身はショップに絶対並ばない限定品で、開封の演出が旧ガチャの高揚感を引き継ぐ。
//
// サーバー側にDB永続化が無い（意図的なスコープ外）ため、品揃えはサーバーが配るのではなく
// 「プレイヤー固有のシード × 時刻(1時間単位)」から決定論的に生成する（storage.jsのgetShopSeed参照）。

// 表示名だけをここで足す（所持判定と付与は cosmetics.js の COSMETIC_OWNERSHIP が持つ）。
// **ラベルの出所は絵の定義そのもの**なので、CardArt.jsx / TableArt.jsx を読むのはこちら側の仕事
// ——あちらに持たせると在庫表がJSXに依存し、テストから読めなくなる。
const COSMETIC_KIND = {
  skin: { ...COSMETIC_OWNERSHIP.skin, label: "カード", name: (refId) => CARD_THEMES[refId]?.label ?? refId },
  table: { ...COSMETIC_OWNERSHIP.table, label: "テーブル", name: (refId) => TABLE_THEMES[refId]?.label ?? refId },
  title: { ...COSMETIC_OWNERSHIP.title, label: "称号", name: (refId) => COSMETIC_TITLES[refId]?.label ?? refId },
};
// レア度の強さ順はCardArt.jsxのRARITY_ORDER（common<rare<epic<legendary）を単一の情報源として使う。
// 開封演出の光の粒(legendaryBurst用)。BattleScreenChromeのWIN_SPARK_ANGLESと同じ考え方の角度配列。
const REWARD_SPARK_ANGLES = Array.from({ length: 10 }, (_, i) => i * 36);
const RARITY_LABEL = { common: "コモン", rare: "レア", epic: "エピック", legendary: "レジェンダリー" };

function cosmeticName(it) {
  return COSMETIC_KIND[it.type].name(it.refId);
}

// このプレイヤー・この時間帯のショップの品揃えを決める。
// 「シャッフルしてから所持済みを除いて先頭N件」という順序が肝: 先に所持済みを除いてからシャッフルすると、
// 1つ買うたびに残り全部の並びが変わり、購入が実質的なリロールとして機能してしまう。
// 乱数は決定論的な mulberry32（shared/engine.js。対戦のカードの山と同じ実装）。Math.random を使うと
// 同じ1時間でもリロードのたびに品揃えが変わり、実質的な引き直しになってしまう。
function buildShopOffers(seed, epoch, soldIds) {
  const rand = mulberry32((seed ^ Math.imul(epoch, 2654435761)) >>> 0);
  const ordered = [...SHOP_STOCK];
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  // この時間帯に買ったものは、所持済みになっても棚に「購入済み」として残す
  // （買った瞬間に消えると、何を買ったのかの手応えが残らないため）。
  return ordered
    .filter((it) => !COSMETIC_KIND[it.type].isOwned(it.refId) || soldIds.includes(it.id))
    .slice(0, SHOP_SLOTS);
}

// 開封結果のレア度に応じてSEの派手さを段階分けする
// （音と光は同じ瞬間に出す。ずれると別々の出来事に見える）。
// 新しいSFXは増やさず、既存のplayCardFlip/playWin/playCoin/playNotify(audio/sfx.js)の
// 組み合わせ・パラメータ調整のみで表現する。
function playRewardRevealCue(rarity) {
  if (rarity === "legendary") {
    playCoin();
    setTimeout(() => playWin(6), 90);
    setTimeout(() => playNotify(), 300);
  } else if (rarity === "epic") {
    playWin(3);
  } else if (rarity === "rare") {
    playWin(0);
  } else {
    playCardFlip();
  }
}

// コスメ1点の見た目プレビュー（カード=実カード、テーブル=フェルトスウォッチ、称号=メダル）。
// ショップの棚とボックス開封結果の両方が使う。
// 3種類は本来の縦横比が違う（カード=5:7、テーブル=横長、称号=アイコン）ため、そのまま並べると
// 棚のカードごとに高さが揃わず、価格ボタンの位置がガタつく。カード1枚分の高さの枠に中央寄せで
// 収めることで、種類が混ざっても行が揃うようにする。
function CosmeticPreview({ it, width = 64 }) {
  const slotHeight = Math.round(width * 1.4); // カード(5:7)の高さに合わせた共通の枠
  const inner = it.type === "skin"
    ? <PlayingCard variant="number" number={3} theme={it.refId} width={width} />
    : it.type === "table"
      ? <TableThemeSwatch themeId={it.refId} width={width} />
      // **称号にも実体を持たせる。** メダルのアイコンだけを置くと、カードや卓と違って枠を埋める物が
      // 何も無く、開封結果のような大きな枠では「空の黒い箱に小さな印が1つ」になる（実際にそう見えた）。
      // 銘板に留めた形にすれば、枠の中に置かれた1つの物として読める。
      : (
        <div style={{
          width: Math.round(width * 0.88), height: Math.round(width * 1.24),
          display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: RADIUS.sm,
          background: "linear-gradient(180deg, rgba(42,33,9,0.9), rgba(12,9,6,0.95))",
          border: `1px solid ${RARITY_COLOR[it.rarity]}66`,
          // 外側の光は持たせない（開封結果では枠の drop-shadow が、棚では枠線が担う）。
          boxShadow: "inset 0 1px 0 rgba(244,231,191,0.12)",
        }}>
          <MedalIcon size={Math.round(width * 0.56)} style={{ color: RARITY_COLOR[it.rarity] }} />
        </div>
      );
  return (
    <div style={{ height: slotHeight, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {inner}
    </div>
  );
}

// ボックス開封結果1枠：伏せ札(裏面がレア度色に光る)をタップして初めてめくれる演出（「一定時間で自動的にめくれる」ではなく、
// 自分の操作でめくる）。
// レア度がepic/legendaryのときだけ発光・バーストアニメを追加し、格差をはっきりさせる
// （レア感は光の強さと縁の輝きだけで作る）。
function RewardRevealSlot({ it, revealed, onReveal }) {
  const prevRef = useRef(revealed);
  const [justFlipped, setJustFlipped] = useState(false);
  useEffect(() => {
    if (!prevRef.current && revealed) {
      setJustFlipped(true);
      const holdMs = it.rarity === "legendary" ? 900 : it.rarity === "epic" ? 550 : 380;
      const t = setTimeout(() => setJustFlipped(false), holdMs);
      prevRef.current = revealed;
      return () => clearTimeout(t);
    }
    prevRef.current = revealed;
  }, [revealed, it.rarity]);

  // カードのめくり自体は3D側(three/Card3D.jsxのuseCardFlipAnimation)が担うため、
  // ここでCSSのcardFlipを重ねると二重にめくれてしまう。CSSアニメはレア度のバースト光だけに絞る。
  const anim = justFlipped && it.rarity === "legendary" ? "legendaryBurst 0.9s ease-out"
    : justFlipped && it.rarity === "epic" ? "epicBurst 0.5s ease-out" : "none";
  // 開封演出は「伏せた3Dカードをタップしてめくる」に統一する。中身がカードスキンの時は同じCanvasの
  // まま実際にその意匠へめくれる（faceDownがtrue→falseになるとCard3Dが潰して戻す本物のめくり演出を
  // 出す）。卓スキンは卓そのもの、称号はメダルに差し替わる。
  const revealedAsCard = revealed && !it.duplicate && (it.type === "skin");
  const revealedAsTable = revealed && !it.duplicate && it.type === "table";
  const show3D = !revealed || revealedAsCard || revealedAsTable;
  const stageCardTheme = it.type === "skin" ? it.refId : getEquippedSkin();

  return (
    <button
      onClick={!revealed ? onReveal : undefined}
      disabled={revealed}
      className={!revealed ? "kj-pressable" : ""}
      style={{
        position: "relative", width: 168, padding: "8px 4px", borderRadius: RADIUS.md, textAlign: "center",
        background: "transparent", border: "none", cursor: !revealed ? "pointer" : "default",
        animation: anim,
      }}
    >
      {justFlipped && it.rarity === "legendary" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 2 }}>
          {REWARD_SPARK_ANGLES.map((angle, i) => (
            <span key={i} style={{
              position: "absolute", width: 5, height: 5, borderRadius: "50%",
              background: i % 2 === 0 ? "#e8c874" : "#FFF3B0",
              animation: `winSpark 0.8s ease-out ${i * 0.02}s`,
              "--spark-angle": `${angle}deg`,
            }} />
          ))}
        </div>
      )}
      {/* レア度の光は**品物の輪郭に沿わせる**（矩形の box-shadow にしない）。
          壁龕を置く前は平らな幕に札が浮いているだけだったので矩形の光でも成立していたが、
          いまは 壁龕 → 光る矩形 → 品物の縁 と枠が三重に同心で並び、どれが物なのか読めなくなる。
          3Dで出る時（カード・卓）は物自体が accentColor で光っているので、ここでは足さない。 */}
      <div style={{
        height: 190, borderRadius: RADIUS.md,
        filter: revealed && !show3D
          ? `drop-shadow(0 0 ${it.rarity === "legendary" ? 18 : it.rarity === "epic" ? 11 : 5}px ${RARITY_COLOR[it.rarity]}${it.rarity === "legendary" ? "cc" : "88"})`
          : "none",
      }}>
        {show3D ? (
          <Suspense fallback={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <PlayingCard variant="number" number={1} faceDown rarityGlow={RARITY_COLOR[it.rarity]} width={92} />
            </div>
          }>
            {revealedAsTable
              ? <TableShowcase3D theme={it.refId} cardTheme={getEquippedSkin()} />
              : <CardShowcase3D
                  theme={stageCardTheme} number={5} faceDown={!revealed}
                  accentColor={RARITY_COLOR[it.rarity]}
                />}
          </Suspense>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <CosmeticPreview it={it} width={120} />
          </div>
        )}
      </div>
      {!revealed ? (
        <div style={{ fontSize: 10, color: SURFACE.textMuted, marginTop: 4 }}>タップで開封</div>
      ) : (
        <>
          <div style={{ fontSize: 10, color: RARITY_COLOR[it.rarity], fontWeight: 700, marginTop: 6 }}>{RARITY_LABEL[it.rarity]}</div>
          <div style={{ fontSize: 11, color: "var(--ivory)", marginTop: 2 }}>{cosmeticName(it)}</div>
          {/* かぶりでも**出た品は見せる**。品名ごと「所持済み」に差し替えていた版は、何が出たのか
              分からないまま結果だけが出て、空振りよりも素っ気なかった。 */}
          {it.duplicate && <div className="kj-reward-dup">所持済み → CHIP +{it.chipAward}</div>}
        </>
      )}
    </button>
  );
}

// 次の入れ替えまでの残り時間（mm:ss）と、現在の入れ替え周期の通し番号を1秒ごとに更新する。
//
// 残り時間が0になったことを検知して差し替える、という書き方は動かない（実際に踏んだ不具合）:
// 残り時間は毎回 getShopNextRotationTs() - Date.now() で計算し直すため、時刻が境目を越えた瞬間に
// 分母側(次の入れ替え時刻)も次の1時間へ進み、残り時間は0を経由せずいきなり約60分へ戻る。
// つまり「0以下になった」という状態はほぼ絶対に観測されず、ページを開いたままだと
// いつまでも品揃えが変わらない。周期の通し番号(epoch)そのものを見て差し替えること。
function useShopClock() {
  const read = () => ({ left: getShopNextRotationTs() - Date.now(), epoch: getShopEpoch() });
  const [clock, setClock] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setClock(read()), 1000);
    return () => clearInterval(id);
  }, []);
  const totalSec = Math.max(0, Math.floor(clock.left / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return { label: `${mm}:${ss}`, epoch: clock.epoch };
}

// ショップの棚1枠。
// onPreview を渡すと、絵の部分が「触って回せる3Dで見る」入口になる。**渡すのはカードと卓だけ**
// ——称号は3Dの実体を持たないので、押せる見た目にすると空の画面が開く。
// 押せるのは絵の部分だけにする：カード全体を押せるようにすると、買うボタンとの区別が消える。
function ShopOfferCard({ it, owned, chips, onBuy, onPreview }) {
  const price = SHOP_PRICE[it.rarity];
  const affordable = chips >= price;
  return (
    <div style={{
      background: SURFACE.card, borderRadius: RADIUS.md, padding: "12px 10px 10px", textAlign: "center",
      border: `1px solid ${owned ? RARITY_COLOR[it.rarity] : SURFACE.hairlineWarm}`,
      boxShadow: owned ? `0 0 12px ${RARITY_COLOR[it.rarity]}44` : "none",
      opacity: owned ? 0.75 : 1,
    }}>
      <div style={{ fontSize: 9, color: SURFACE.textMuted, letterSpacing: "0.08em", marginBottom: 6 }}>
        {COSMETIC_KIND[it.type].label}
      </div>
      {onPreview ? (
        <button type="button" onClick={onPreview} className="kj-pressable"
          aria-label={`${cosmeticName(it)} を3Dで見る`}
          style={{ display: "block", width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
          <CosmeticPreview it={it} width={64} />
        </button>
      ) : <CosmeticPreview it={it} width={64} />}
      <div style={{ fontSize: 10, color: RARITY_COLOR[it.rarity], fontWeight: 700, marginTop: 6 }}>{RARITY_LABEL[it.rarity]}</div>
      {/* 名前は1行に収まるものと2行に折り返すものが混ざるため、高さを固定して価格ボタンの位置を揃える */}
      <div style={{
        fontSize: 11, color: "var(--ivory)", marginTop: 2, marginBottom: 8, height: 32,
        display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1.35,
      }}>{cosmeticName(it)}</div>
      {owned ? (
        <div style={{
          padding: "8px 0", borderRadius: RADIUS.sm, fontSize: 12, fontWeight: 700,
          color: RARITY_COLOR[it.rarity], border: `1px solid ${RARITY_COLOR[it.rarity]}66`,
        }}>購入済み</div>
      ) : (
        <button onClick={onBuy} disabled={!affordable} className="kj-pressable" style={{
          width: "100%", padding: "8px 0", borderRadius: RADIUS.sm, cursor: affordable ? "pointer" : "not-allowed",
          border: `1px solid ${affordable ? "var(--gilt)" : SURFACE.hairlineWarm}`,
          background: affordable ? "linear-gradient(180deg, #2a2109, #171009)" : "transparent",
          color: affordable ? "var(--ivory)" : SURFACE.textMuted,
          fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        }}>
          <ChipIcon size={12} /> {price}
        </button>
      )}
    </div>
  );
}

// 3Dプレビューの角度。引っ張れるのは縦横とも ±ROT_MAX まで（表の面しか見せない。onDragMove の注記）。
const ROT_MAX = 0.6;
// 手を離した後、正面へ戻るばね。剛性 K と減衰 C は「少しだけ行き過ぎて、0.6秒ほどで止まる」ように決めた。
const SPRING_K = 90;
const SPRING_C = 11;

// ショップ／ボックスをまとめた画面（旧GachaScreen）。
export function ShopScreen({ onWalletChange, initialTab = "shop" }) {
  const [tab, setTab] = useState(initialTab); // "shop" | "box"
  const [chips, setChips] = useState(getChips());
  // 棚の1点を3Dで見る（触って角度を変えられる）。**角度はDOM側が持つ**——ポインタの取り回しは
  // DOMの仕事で、three.js 側に持たせるとチャンクに入る（Showcase3D の rotation の注記参照）。
  const [preview, setPreview] = useState(null);
  const [rot, setRot] = useState({ x: 0, y: 0 });
  // **手を離すと正面へばねで戻る。引っ張っている間はゴムのように重くなる**。
  // ばねは毎フレーム前の角度と速度から次を決めるので、state ではなく ref に最新値を持つ
  // （requestAnimationFrame の中から state を読むと、登録した時点の古い値を掴む）。
  const rotRef = useRef({ x: 0, y: 0 });
  const velRef = useRef({ x: 0, y: 0 });
  const springRef = useRef(0);
  const dragRef = useRef(null);
  const applyRot = (r) => { rotRef.current = r; setRot(r); };
  const stopSpring = () => { cancelAnimationFrame(springRef.current); springRef.current = 0; };
  useEffect(() => () => cancelAnimationFrame(springRef.current), []);
  const openPreview = (it) => { stopSpring(); setPreview(it); applyRot({ x: 0, y: 0 }); playClick(); };
  // 引っ張った量 → 角度。**tanh で ±ROT_MAX に近づくほど動かなくなる**＝端で突然止まらず、重くなって止まる。
  const band = (pull) => ROT_MAX * Math.tanh(pull / ROT_MAX);
  // その逆。戻っている途中で掴み直した時、いまの角度から続けて引っ張れるようにする（跳ねない）。
  const unband = (angle) => ROT_MAX * Math.atanh(Math.max(-0.999, Math.min(0.999, angle / ROT_MAX)));
  const onDragStart = (e) => {
    stopSpring();
    dragRef.current = { x: e.clientX, y: e.clientY, px: unband(rotRef.current.x), py: unband(rotRef.current.y) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    // 横で首を振り、縦で見下ろす。**縦も横も±0.6radを越えない＝表の面しか見せない**
    // 。
    // 裏まで回ると、何を見ているのか分からない面（カードの裏＝どのスキンでも同じ絵／卓の底）が
    // 正面に来るだけで、買う前に確かめたい物からはむしろ遠ざかる。
    applyRot({ x: band(d.px + (e.clientY - d.y) * 0.01), y: band(d.py + (e.clientX - d.x) * 0.01) });
  };
  const onDragEnd = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // モーション低減では揺れながら戻さず、その場で正面へ置く。
    if (getSettings().reduceMotion) { applyRot({ x: 0, y: 0 }); return; }
    velRef.current = { x: 0, y: 0 };
    let last = performance.now();
    const step = (now) => {
      // タブが裏に回ると間隔が大きく空くので、1コマの時間に上限を置く（置かないと一気に振り切れる）。
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const r = rotRef.current;
      const v = velRef.current;
      const nv = { x: v.x + (-SPRING_K * r.x - SPRING_C * v.x) * dt, y: v.y + (-SPRING_K * r.y - SPRING_C * v.y) * dt };
      const nr = { x: r.x + nv.x * dt, y: r.y + nv.y * dt };
      velRef.current = nv;
      if (Math.abs(nr.x) + Math.abs(nr.y) < 0.002 && Math.abs(nv.x) + Math.abs(nv.y) < 0.02) {
        applyRot({ x: 0, y: 0 });
        springRef.current = 0;
        return;
      }
      applyRot(nr);
      springRef.current = requestAnimationFrame(step);
    };
    springRef.current = requestAnimationFrame(step);
  };
  const [boxes, setBoxes] = useState(getBoxes());
  const [soldIds, setSoldIds] = useState(getShopSoldIds());
  const [reward, setReward] = useState(null); // 開封結果（確定値。付与は開封時点で完了済み）
  const [revealed, setRevealed] = useState(false);
  const [opening, setOpening] = useState(false); // 開封前の「間」の演出中
  const [legendaryFlash, setLegendaryFlash] = useState(false);
  const timersRef = useRef([]);
  const clock = useShopClock();
  const epoch = clock.epoch; // 1時間の境目をまたぐと自動で次の周期に切り替わる

  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  // 周期が変わったら「この時間帯に買ったもの」の記録も引き直す（storage側も周期違いなら空を返す）。
  useEffect(() => { setSoldIds(getShopSoldIds()); }, [epoch]);

  const seed = getShopSeed();
  const offers = useMemo(() => buildShopOffers(seed, epoch, soldIds), [seed, epoch, soldIds]);

  const buy = (it) => {
    const price = SHOP_PRICE[it.rarity];
    if (getChips() < price || COSMETIC_KIND[it.type].isOwned(it.refId)) return;
    addChips(-price);
    COSMETIC_KIND[it.type].grant(it.refId);
    markShopSold(it.id);
    setChips(getChips());
    setSoldIds(getShopSoldIds());
    onWalletChange?.();
    playCoin();
  };

  const openBox = (boxType) => {
    if (opening || reward) return;
    // 中身の定義が無いボックスは開けない（在庫も減らさない）。抽選側が既定値で埋めていた頃は、
    // 定義の抜けが「かぶり」に化けて画面からは運が悪いのと区別できなかった。
    if (!boxPool(boxType)) return;
    if (!consumeBox(boxType)) return;
    setBoxes(getBoxes());
    setOpening(true);
    setRevealed(false);
    setLegendaryFlash(false);
    // 結果は「開ける」を押した時点で確定させ、演出はその表示だけを担う
    // （演出中に抽選すると、途中で画面を離れたときに報酬が消える事故になりうる）。
    const rolled = rollBoxReward(boxType);
    setChips(getChips());
    onWalletChange?.();
    playBoxOpen();
    // **モーション低減では動きだけでなく待ちも消す**。CSSのアニメは index.css の
    // 全称ルールが殺すが、この待ちはJSのタイマーなので別に畳む必要がある——残すと、動きの無い
    // 暗い画面を0.85秒眺めるだけの時間になる（前庭系への配慮とは何の関係もない）。
    const hold = getSettings().reduceMotion ? 0 : 850;
    const t = setTimeout(() => {
      setReward(rolled);
      setOpening(false);
    }, hold);
    timersRef.current.push(t);
  };

  const revealReward = () => {
    if (!reward || revealed) return;
    setRevealed(true);
    playRewardRevealCue(reward.rarity);
    if (reward.rarity === "legendary") {
      setLegendaryFlash(true);
      const t = setTimeout(() => setLegendaryFlash(false), 900);
      timersRef.current.push(t);
    }
  };

  const closeReward = () => { setReward(null); setRevealed(false); };

  const TABS = [
    { id: "shop", label: "ショップ", Icon: ShopIcon },
    { id: "box", label: "ボックス", Icon: BoxIcon },
  ];
  const totalBoxes = Object.values(boxes).reduce((s, n) => s + n, 0);

  return (
    <div className="kj-page-scroll" style={{ height: "100%", overflowY: "auto", position: "relative" }}>
      {/* 画面名は出さない。どのタブに居るかはナビの線が示している。
          残高だけは、買う場所なのでこの画面にも置いたまま右端に残す。 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-display)", fontSize: 15, color: "#e8c874" }}>
          <ChipIcon size={16} /> {chips}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className="kj-pressable" style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "10px 0", borderRadius: RADIUS.sm,
            background: tab === t.id ? "linear-gradient(135deg, #3a2f00, #171721)" : SURFACE.card,
            border: tab === t.id ? "1px solid #e8c874" : "1px solid transparent",
            color: tab === t.id ? "#e8c874" : SURFACE.textMuted, cursor: "pointer",
          }}>
            <t.Icon size={14} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>{t.label}</span>
            {t.id === "box" && totalBoxes > 0 && (
              <span style={{
                marginLeft: 2, minWidth: 16, padding: "1px 5px", borderRadius: 8,
                background: PENALTY_RED, color: "#fff", fontSize: 10, fontWeight: 700,
              }}>{totalBoxes}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "shop" && (
        <>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: SURFACE.card, borderRadius: RADIUS.md, padding: "10px 14px", marginBottom: 14,
          }}>
            {/* 小さく添えるだけ。残り時間は今まで通りの大きさで出す。 */}
            <div style={{ fontSize: 9, color: SURFACE.textMuted, lineHeight: 1.5 }}>
              品揃えは1時間ごとに入れ替わる。<br />
              対戦で稼いだ CHIP で、スキンと称号を手に入れる。
            </div>
            <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
              <div style={{ fontSize: 9, color: SURFACE.textMuted, letterSpacing: "0.1em" }}>NEXT</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ivory)" }}>{clock.label}</div>
            </div>
          </div>

          {offers.length === 0 ? (
            <div style={{ textAlign: "center", color: SURFACE.textMuted, fontSize: 13, padding: "28px 0", lineHeight: 1.7 }}>
              すべて所持済み。
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
              {offers.map((it) => (
                <ShopOfferCard
                  key={it.id}
                  it={it}
                  owned={COSMETIC_KIND[it.type].isOwned(it.refId)}
                  chips={chips}
                  onBuy={() => buy(it)}
                  onPreview={it.type === "title" ? undefined : () => openPreview(it)}
                />
              ))}
            </div>
          )}

          {/* レア度と価格の凡例は撤去した。棚の1枚1枚が
              レア度の色と定価をそのまま出しているので、同じことを下でもう一度言っていた。 */}
        </>
      )}

      {tab === "box" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Object.entries(BOX_TYPES).map(([type, meta]) => {
              const count = boxes[type] || 0;
              return (
                <div key={type} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  background: SURFACE.card, borderRadius: RADIUS.md, padding: 14,
                  border: `1px solid ${count > 0 ? "var(--gilt)" : SURFACE.hairlineWarm}`,
                  boxShadow: count > 0 ? "0 0 14px rgba(202,164,82,0.22)" : "none",
                }}>
                  <BoxIcon size={38} style={{ color: count > 0 ? "var(--gilt-bright)" : SURFACE.textMuted, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: count > 0 ? "var(--ivory)" : SURFACE.textMuted,
                    }}>{meta.label}</div>
                    <div style={{ fontSize: 10, color: SURFACE.textMuted, marginTop: 2 }}>{meta.desc}</div>
                  </div>
                  <div style={{ textAlign: "center", flexShrink: 0 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: count > 0 ? "var(--ivory)" : SURFACE.textMuted }}>
                      ×{count}
                    </div>
                    <button
                      onClick={() => openBox(type)}
                      disabled={count <= 0 || opening || !!reward}
                      className="kj-pressable"
                      style={{
                        marginTop: 4, padding: "6px 14px", borderRadius: RADIUS.sm,
                        border: `1px solid ${count > 0 ? "var(--gilt)" : SURFACE.hairlineWarm}`,
                        background: count > 0 ? "linear-gradient(180deg, #2a2109, #171009)" : "transparent",
                        color: count > 0 ? "var(--ivory)" : SURFACE.textMuted,
                        fontSize: 12, fontWeight: 700,
                        cursor: count > 0 && !opening && !reward ? "pointer" : "not-allowed",
                      }}
                    >開ける</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 開封の層。**`.kj-app-shell` の外側へ portal する**（ロード画面 `.kj-launch` と同じ扱い）。
          ショップのページの中に absolute で敷いていた版は、棚の行が0.82の幕越しに透けて
          「一覧の上に浮いた小窓」にしか見えず、さらにページがスクロールしていると層そのものが
          画面の外に残った（`.kj-page-scroll` の中身に対する inset:0 なので）。
          開封の「間」と結果は同じ1枚の層の中で切り替える——押した位置から視線を動かさずに済み、
          幕が張り直されないので箱から札への繋ぎが切れない。 */}
      {/* 棚の1点を3Dで見る層。開封の層と同じ建材（壁龕＋金の二重トリム＋石の面）を使い回す
          ——同じ「1点を据えて見せる」場面なので、別の見た目を作ると画面の中に2つの作法が並ぶ。 */}
      {preview && createPortal(
        <div className="kj-reward" onClick={() => setPreview(null)}>
          <div
            className="kj-reward-stage"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onDragStart} onPointerMove={onDragMove}
            onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
            style={{ touchAction: "none", cursor: "grab" }}
          >
            <div className="kj-reward-niche kj-arch kj-gilt kj-plate" aria-hidden="true" />
            <div className="kj-preview-3d">
              {/* 3Dが読めるまでは同じ物の2D版を出す（枠が空にならないようにする既存の作法）。 */}
              <Suspense fallback={<CosmeticPreview it={preview} width={120} />}>
                {preview.type === "table"
                  ? <TableShowcase3D theme={preview.refId} cardTheme={getEquippedSkin()} rotation={rot} />
                  : <CardShowcase3D theme={preview.refId} number={5} accentColor={RARITY_COLOR[preview.rarity]} rotation={rot} />}
              </Suspense>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--ivory)" }}>{cosmeticName(preview)}</div>
          <button onClick={() => setPreview(null)} className="kj-pressable kj-reward-close">閉じる</button>
        </div>,
        document.body,
      )}

      {(opening || reward) && createPortal(
        <div
          className="kj-reward"
          // めくる前は幕を押しても閉じない（結果は既に確定しているので失う物は無いが、
          // 見ないまま消えると何が出たのか分からなくなる）。
          onClick={revealed ? closeReward : undefined}
        >
          {legendaryFlash && <div className="kj-reward-flash" aria-hidden="true" />}

          <div className="kj-reward-stage" onClick={(e) => e.stopPropagation()}>
            {/* 灯りの当たる壁龕。**中身を囲う形で敷く**——画面中央の固定寸法で置くと、下に並ぶ
                「閉じる」が縁に重なる。ロビーと同じ建材3枚（アーチ・金の二重トリム・石の面）だけで組む。 */}
            <div className="kj-reward-niche kj-arch kj-gilt kj-plate" aria-hidden="true" />
            {opening
              ? <div className="kj-reward-box"><BoxIcon size={72} /></div>
              : <RewardRevealSlot it={reward} revealed={revealed} onReveal={revealReward} />}
          </div>

          {opening && <div className="kj-reward-caption">OPENING</div>}
          {reward && revealed && (
            <button onClick={closeReward} className="kj-pressable kj-reward-close">閉じる</button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
