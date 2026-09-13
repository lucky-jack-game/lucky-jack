// カードシュー（配札の機械）。カードは山札からではなく、カジノにあるような機械から
// プシュッと出てくる。山札の絵は要らず、機械とそこから出てくる動きだけで済む。
//
// ── なぜ山札を置かないのか ──
// 山札の絵を置くと「残り何枚あるか」を数えたくなるが、このゲームは**60枚のうち一部しか
// 配らない**ことでカウンティングを成立させない設計になっている
// 。減っていく山を見せると、その設計と矛盾した
// 期待を持たせることになる。機械なら中身が見えないことに理由が要らない。
//
// ── 作りの制約 ──
// イラスト制作パイプラインが無いので、機械もプリミティブ（角丸の箱＋板）だけで組む。
// 写実性ではなく「役割が読めること」で成立させる——手(three/Hand3D.jsx)と同じ方針。
import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { Card3D } from "./Card3D.jsx";
import { useReduceMotion3D } from "./useReduceMotion3D.js";
import { playDispense } from "../audio/sfx.js";
import { DEAL_MS, DEAL_STAGGER_MS, dealtPerSide } from "./dealTiming.js";

// 卓の金物と同じアンティークゴールド。**機械だけ別の金属にしないこと**——卓・カードの縁と
// 同じ体系の金にしておかないと、そこだけ別世界の道具が置かれているように見える。
const BODY = "#1a1410";
const TRIM = "#caa452";
const SLOT = "#080605";

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

// 装填されたカードの小口（背表紙のように見える細い線）。象牙色。
const CARD_EDGE = "#e8dcc0";

// 機械本体。
//
// **カメラは卓に正対しているので、機械も「正面から見た絵」として成立させる必要がある。**
// 初版は箱に金の横線を3本入れただけで、実機で見ると帳簿か本の背に見えた（実際にそうなった）。
// カードシューだと読ませるのに要るのは次の2つで、どちらも欠かせない:
//   ① 上に**装填されたカードの小口**が見えていること（＝中身がカードだと分かる）
//   ② 下に**排出口**があること（＝そこから出てくると分かる）
// 装飾を増やすのではなく、この2つを大きく取るほど機械らしくなる。
export function Dispenser3D({ anchor }) {
  if (!anchor) return null;
  const W = 1.28, H = 1.9;
  return (
    <group position={anchor.position} scale={anchor.scale}>
      {/* 本体（暗い金属の箱） */}
      <RoundedBox args={[W, H, 0.42]} radius={0.08} smoothness={3} position={[0, 0, 0.21]}>
        <meshStandardMaterial color={BODY} roughness={0.45} metalness={0.6} />
      </RoundedBox>
      {/* 左右の金のレール。輪郭に金属の縁が回ることで、卓の金物と同じ体系の道具に見える。 */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (W / 2 - 0.05), 0, 0.43]}>
          <boxGeometry args={[0.07, H - 0.1, 0.06]} />
          <meshStandardMaterial color={TRIM} roughness={0.3} metalness={0.92} />
        </mesh>
      ))}

      {/* ① 装填されたカードの小口。窪みに象牙色の細い線を重ねる。 */}
      <mesh position={[0, 0.34, 0.43]}>
        <boxGeometry args={[W - 0.24, 1.02, 0.04]} />
        <meshStandardMaterial color={SLOT} roughness={0.95} metalness={0.05} />
      </mesh>
      {[0.72, 0.56, 0.4, 0.24, 0.08, -0.08].map((y) => (
        <mesh key={y} position={[0, y, 0.46]}>
          <boxGeometry args={[W - 0.34, 0.075, 0.02]} />
          <meshStandardMaterial color={CARD_EDGE} roughness={0.75} metalness={0.05} />
        </mesh>
      ))}

      {/* ② 排出口。**カードが出てくる場所が一目で分かること**が、この機械に要る唯一の説明。 */}
      <mesh position={[0, -0.66, 0.43]}>
        <boxGeometry args={[W - 0.18, 0.3, 0.05]} />
        <meshStandardMaterial color={SLOT} roughness={0.95} metalness={0.05} />
      </mesh>
      {/* 口の下唇の金（ここが「出口」だと言い切る1本） */}
      <mesh position={[0, -0.83, 0.44]}>
        <boxGeometry args={[W - 0.1, 0.09, 0.07]} />
        <meshStandardMaterial color={TRIM} roughness={0.28} metalness={0.92} emissive={TRIM} emissiveIntensity={0.18} />
      </mesh>
    </group>
  );
}

// 排出口から出て、受け取る側へ滑っていく1枚。着いたら消える（手札はDOM側のドックにあり、
// 卓の上には残らないため）。**弧を描かせないこと**——卓の上を滑らせる。
function DispensedCard({ started, from, to, theme, delay }) {
  const ref = useRef(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = clamp01((performance.now() - started - delay) / DEAL_MS);
    const e = easeOutCubic(t);
    g.position.set(
      from[0] + (to[0] - from[0]) * e,
      from[1] + (to[1] - from[1]) * e,
      0.08,
    );
    // 最後の2割で消える（受け取り手の手札に収まったことを示す）。
    const fade = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
    g.scale.setScalar(Math.max(0.001, 0.34 * (0.55 + 0.45 * e) * fade));
    g.visible = t > 0 && t < 1;
  });
  return (
    <group ref={ref} visible={false}>
      <Card3D variant="number" faceDown theme={theme} />
    </group>
  );
}

// dealKey が変わったら「両者に1枚ずつ配る」を1回だけ走らせる。
// **キーは局番号にすること。** カードの中身をキーにすると、同じ札を続けて引いたときに
// 取りこぼす（旧実装が deckIndex と消費枚数の組を必要としたのと同じ理由だが、
// 局番号なら必ず単調に増えるのでその組み立て自体が要らない）。
export function useDispense(dealKey) {
  const [state, setState] = useState(null);
  // 何枚ずつ配るか。**1局目は2枚**（手札を作る局なので、1枚しか出さないと、
  // 出てきていないはずの2枚目が最初から手札に並んでいることになる——実際にそう見えていた）。
  const perSide = dealtPerSide(dealKey ?? 1);
  // **初期値は必ず null にすること。** dealKey で初期化すると、3Dチャンクの読み込みが済んだ時点で
  // 既に1局目が始まっているため「変化していない」と判定され、**1局目だけ配札が出ない**
  // ——機械が何をするものなのかを最初に示す1回を落とすことになる。
  const prevRef = useRef(null);
  const reduceMotion = useReduceMotion3D();

  useEffect(() => {
    const changed = prevRef.current !== dealKey;
    prevRef.current = dealKey;
    if (!changed || dealKey == null) return;
    // **モーション低減で消すのは「動き」だけ。** 音まで一緒に止めると、その設定を選んだ人は
    // 配札が起きたこと自体に気付けなくなる（前庭系への配慮であって、音を消したい設定ではない）。
    // 音量は設定画面のSEスライダーが別に持っている。
    // 配る枚数ぶん鳴らす。**1枚ずつずらすこと**——同時に鳴らすと1回の大きな音に潰れて、
    // 「何枚配ったか」が音からは伝わらない（画面のずれ幅と揃えてある）。
    playDispense();
    const timers = [];
    for (let i = 1; i < perSide * 2; i++) timers.push(setTimeout(playDispense, i * DEAL_STAGGER_MS));
    if (!reduceMotion) setState({ started: performance.now(), perSide });
    return () => timers.forEach(clearTimeout);
  }, [dealKey, reduceMotion, perSide]);

  useFrame(() => {
    if (!state) return;
    const span = DEAL_MS + (state.perSide * 2 - 1) * DEAL_STAGGER_MS + 220;
    if (performance.now() - state.started >= span) setState(null);
  });

  return state;
}

export function DispenseFx({ deal, anchors, cardTheme }) {
  if (!deal || !anchors?.dispenser) return null;
  // 出発点は排出口の高さ（機械のローカル -0.66 をワールドへ直す）。
  const d = anchors.dispenser;
  const mouth = [d.position[0], d.position[1] - 0.66 * d.scale, 0];
  const seats = [anchors.selfSeat, anchors.oppSeat].filter(Boolean);
  // **配る順は「自分→相手」を枚数ぶん繰り返す。** 片方に全部配ってからもう片方、にすると
  // 実際のディーラーの手つきと違ううえ、手札のDOM側が着地時刻を計算しづらくなる
  // （dealTiming.js の selfCardLandsAt がこの順序を前提にしている）。
  const cards = [];
  for (let n = 0; n < (deal.perSide ?? 1); n++) {
    seats.forEach((seat, s) => cards.push({ seat, order: n * seats.length + s, key: `${n}-${s}` }));
  }
  return (
    <>
      {cards.map(({ seat, order, key }) => (
        <DispensedCard key={key} started={deal.started} delay={order * DEAL_STAGGER_MS}
          from={mouth} to={[seat.position[0], seat.position[1], 0]} theme={cardTheme} />
      ))}
    </>
  );
}
