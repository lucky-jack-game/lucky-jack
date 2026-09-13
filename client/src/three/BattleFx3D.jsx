// 対戦画面の3D演出（カードをめくる手・チップが移動する演出）。
// three/BattleScene3D.jsxの構成が「何をどこに置くか」だけを扱うのに対し、ここは「何が動くか」を扱う。
//
// ── 設計方針 ──
// ・毎フレームの更新はReactのstateではなくref経由でThree.jsのオブジェクトを直接動かす
//   （state更新を毎フレーム走らせるとR3F以外のDOM側まで再レンダーが波及するため）。
//   stateを触るのは「演出の開始/終了」の2回だけ。
// ・設定の「モーション低減」がONのときは演出そのものを出さない（手が卓を横切るのは
//   付随的な動きの中でも特に大きいため。three/useReduceMotion3D.js参照）。
import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Hand3D } from "./Hand3D.jsx";

import { useReduceMotion3D } from "./useReduceMotion3D.js";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;

// ────────────────────────────────────────────────────────────
// カードをめくる手
// ────────────────────────────────────────────────────────────
// Card3D自身のめくり演出(scale.xが潰れて戻る、FLIP_DURATION_MS=380)はそのまま残し、
// その上に「手が伸びてきて札をひっくり返し、引く」動きを重ねる。手が札を覆い隠してしまうと肝心の数字が見えなくなるので、
// 指先が札の中央手前で止まる高さに抑え、手のひらは常に札の下(相手は上)に置く。
const REVEAL_MS = 760;
const REVEAL_HAND_SCALE = 1.6; // FieldSlotグループ内（カード幅2.824）での手の大きさ
// 待機位置（カード高さ4の外）。3行グリッドになって卓が小さくなったぶん、大きく引くと袖が
// 卓の外の暗がりに黒い棒として残って見える。札から外れるぶんだけ引けば足りる。
const REVEAL_FAR_Y = 4.4;
// 手のひらの位置。Hand3Dは指先が手のひらから約1.48上にあるので、×スケールぶん引いた値にすると
// 指先がちょうど札の中央あたりに届く（これ以上寄せると数字が指で隠れる）。
const REVEAL_NEAR_Y = 2.15;

// この<group>はFieldSlot(three/BattleScene3D.jsx)の中に置くので、座標はカード基準
// （カードは幅2.824・高さ4で中心が原点）。FieldSlot側のscaleが自動的に掛かる。
export function CardRevealHand({ revealed, side = "self" }) {
  const ref = useRef(null);
  const startRef = useRef(null);
  const prevRef = useRef(revealed);
  const [active, setActive] = useState(false);
  const reduceMotion = useReduceMotion3D();
  const sign = side === "opp" ? 1 : -1; // 自分は下から、相手は上から伸びてくる

  useEffect(() => {
    if (!reduceMotion && prevRef.current === false && revealed === true) {
      startRef.current = performance.now();
      setActive(true);
    }
    prevRef.current = revealed;
  }, [revealed, reduceMotion]);

  useFrame(() => {
    if (startRef.current == null) return;
    const t = (performance.now() - startRef.current) / REVEAL_MS;
    if (t >= 1) {
      startRef.current = null;
      setActive(false);
      return;
    }
    const g = ref.current;
    if (!g) return;
    // 0.00-0.30 差し出す / 0.30-0.48 札に触れている(この間にCard3Dが潰れて絵柄が変わる) / 0.48-1 引く
    let reach;
    if (t < 0.3) reach = easeOutCubic(t / 0.3);
    else if (t < 0.48) reach = 1;
    else reach = 1 - easeInCubic((t - 0.48) / 0.52);
    g.position.y = sign * lerp(REVEAL_FAR_Y, REVEAL_NEAR_Y, reach);
    g.position.z = lerp(1.6, 0.75, reach);
    // 手首をひねる＝札を返す仕草。触れている間だけ大きく回る。
    g.rotation.y = Math.sin(Math.min(1, t / 0.6) * Math.PI) * 0.62;
    g.rotation.z = sign * -0.1 * reach;
  });

  if (!active) return null;
  return (
    <group ref={ref} position={[0, sign * REVEAL_FAR_Y, 1.6]}>
      <Hand3D side={side} scale={REVEAL_HAND_SCALE} />
    </group>
  );
}

// ────────────────────────────────────────────────────────────
// チップの移動
// ────────────────────────────────────────────────────────────
// ── チップは「飛ぶ」のではなく「滑る」 ──
// 旧実装は移動中に画面Y方向へ0.3、カメラ方向へ0.7持ち上げて放物線を描かせていた。結果として
// チップの塔が卓から浮き上がって空中を運ばれるように見えていたが、実際のカジノでチップが
// 宙を舞うのはトラブルの時だけで、賭けも払い出しも**フェルトの上を滑らせる**動作しかない。
// 弧はごくわずかに残し（完全な直線だと機械的な平行移動に見える）、浮きは卓とのZファイティングを
// 避けるぶんだけにする。
// 着地の行き過ぎ量。滑らせたチップは狙った位置でぴたりとは止まらず、わずかに滑り越えてから
// 戻る。この一往復があるかどうかで「置いた」のか「テレポートした」のかが分かれる。
// チップに対する手の大きさ。**指先がチップに届く程度**に留めること。Hand3Dは手のひらから
// 指先まで約1.48あるので、これを大きくすると手が卓の主役になってカードより目立つ（実際にそうなった）。





// ────────────────────────────────────────────────────────────
// 配札（山札 → 場札）
// ────────────────────────────────────────────────────────────
// 山札(DeckPile3D)を導入したことで初めて意味を持つ演出。旧構成では手札が横一列に並んでいて
// 「どこから配られたのか」を示せる場所が無かったが、山があるなら山から飛んでくるのが自然。




// ────────────────────────────────────────────────────────────
// 場に置かれる瞬間の登場演出（KING/JOKER札）
// ────────────────────────────────────────────────────────────
// 選択が確定した瞬間にKJ札がフレーム単位で「出現」していたのを、伏せた札を表に返して置く
// 動きに置き換える。trigger が falsy → truthy に変わったときに1回走る。
const APPEAR_MS = 420;

export function AppearGroup({ trigger, children, ...groupProps }) {
  const ref = useRef(null);
  const startRef = useRef(null);
  const prevRef = useRef(!!trigger);
  const reduceMotion = useReduceMotion3D();

  useEffect(() => {
    if (!reduceMotion && !prevRef.current && trigger) startRef.current = performance.now();
    prevRef.current = !!trigger;
  }, [trigger, reduceMotion]);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    if (startRef.current == null) {
      g.scale.set(1, 1, 1);
      return;
    }
    const t = clamp01((performance.now() - startRef.current) / APPEAR_MS);
    const e = easeOutCubic(t);
    // **Y軸で回してはいけない**: 押し出しカードは裏面が本体色そのままの平板なので、
    // 途中で裏を向いた瞬間に「のっぺりした色板」が見える（実際にそうなった）。
    // Card3Dのめくり演出と同じく、横に潰れた状態から広がる動きにすれば裏面は一度も露出しない。
    g.scale.set(Math.max(0.02, e), lerp(1.1, 1, e), lerp(1.1, 1, e));
    if (t >= 1) startRef.current = null;
  });

  return <group ref={ref} {...groupProps}>{children}</group>;
}
