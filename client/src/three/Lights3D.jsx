// 賭けたライフ（ポット）の3D表現。卓に乗るのは「いま賭かっている分」だけで、1粒＝1ライフ。
//
// **人型の人形は使わない**（このゲームの語彙は金・象牙・
// フェルト・緑青・紫水晶でできていて、人物表現を一つも持っていない）。
//
// **チップ(旧 three/Chip3D.jsx)の後継。** 旧経済はポイントを賭けたのでチップの塔が要ったが、
// 賭ける単位が整数のライフになったので「1つ＝1ライフ」の粒がそのまま額を表す
// 。
//
// 残ライフを卓に並べる版（器＋灯りの LifeLights3D）もあったが、「卓に乗るのは賭けた分だけ」と
// 決めた時点で呼び出し元が無くなったので削除した。戻すときは git の履歴から取り出すこと。
import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useReduceMotion3D } from "./useReduceMotion3D.js";

// 自分=金、相手=紫水晶。SeatCard/SeatPlateの縁の色と揃えてある（同じものを指しているので、
// 卓の上とDOMで色が食い違うと別のものに見える）。
export const LIFE_COLOR = { self: "#F2C230", opp: "#B06BFF" };

const R = 0.17;
const GAP = 0.46;
// **1つの列に積む段数の上限。** ライフはゼロサムなので片方が最大 lives×2（=12〜14）まで増える。
// 段数を固定にすると、増えたぶんが縦に伸びて上下の行（場札・KJ札）へ食い込む——行の高さは
// 目印1つぶん(4.6*cardScale≒1.8)しか無い。段を3で頭打ちにして、横へ広げる側で吸収する。
const MAX_ROWS = 3;

// 賭けた灯りが中央へ滑る時間。カードのめくり(380ms)より少しだけ長く取って「押し出した」感じを出す。
const SLIDE_MS = 460;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

// ─── ジオメトリ/マテリアルはモジュールで1つずつ持つ ───
// **粒ごとに new しないこと。** このリポジトリは three/geometryCache.js を用意してまで
// 「同じ設計のものは1つのジオメトリを共有する」方針を取っている（旧LayeredSVG3Dが呼ばれるたびに
// 生成をやり直していた反省）。ポットには1画面に20個以上並ぶので、素直に書くと球と材質が
// 40〜60個できる。色は「自分／相手」の2つしかないので、最初に作って使い回す。
const BODY_GEO = new THREE.SphereGeometry(R, 20, 16);

const litMat = (color) => new THREE.MeshStandardMaterial({
  color, emissive: color, emissiveIntensity: 1.5, roughness: 0.25, metalness: 0.1,
});
const MATS = {
  litSelf: litMat(LIFE_COLOR.self),
  litOpp: litMat(LIFE_COLOR.opp),
};
// ─── 灯りの滲み ───
// **濃さが一様な球を被せても、光っては見えない。** 以前は半径2.1Rの球を opacity 0.16 で
// 被せていたが、球の正面は中心も端も同じ濃さなので、中央を灯り本体に覆われると
// **薄い輪郭が1本残るだけ**になる（実機でそう見えていた）。
// 遊び方画面の灯り（screens/TutorialOverlay.jsx の TutorialLifeRow）は box-shadow で外へ滑らかに
// 減衰していて、**あちらが正しい見え方**。同じ減衰を3Dで作るには「中心から外へ濃さが落ちる絵」を
// 1枚持つしかない——面の数を増やしても、一様な濃さは一様なままなので直らない。
// 1粒ずつ PointLight を置く手もあるが、ライト数が跳ね上がって描画が落ちるので使わない。
//
// **加算合成にすること。** 隣り合う灯りが重なった所が暖かい光だまりになる（蝋燭を並べた時の
// 見え方）。通常合成だと重なりが逆に暗い染みになり、粒の隙間だけが目立つ。
const GLOW_SIZE = R * 5.4; // 半径にすると GAP とほぼ同じ。隣の灯りの中心でちょうど0まで落ちる
const GLOW_GEO = new THREE.PlaneGeometry(GLOW_SIZE, GLOW_SIZE);
// 卓は tiltX:0（layoutAnchors.js）でカメラに正対しているので、板1枚で常に正面を向く
// ——Spriteのような常時カメラ追従は要らない。
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // 内側は灯り本体の球が覆うので、効くのは**外へ出てからの落ち方**だけ。
  // **中心を濃くしすぎないこと。** 加算合成なので、芯の近くは灯り本体(emissive)と足し算になって
  // すぐ飽和し、金も紫水晶も同じ白い塊になる——色を運んでいるのは灯りの側なので、滲みは
  // 「明るさを外へ配る」だけに留める。
  for (const [stop, a] of [[0, 0.58], [0.18, 0.44], [0.34, 0.22], [0.58, 0.07], [1, 0]]) {
    g.addColorStop(stop, `rgba(255,255,255,${a})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
// 材質もモジュールで1つずつ持つ（このファイルの他の材質と同じ理由）。テクスチャの生成に
// canvasが要るので**最初に必要になった時に作る**——モジュール読み込み時に document を触ると、
// 3Dチャンクをブラウザ以外から読んだ瞬間に落ちる。
const GLOW_MATS = {};
function glowMat(tone) {
  if (!GLOW_MATS[tone]) {
    GLOW_MATS[tone] = new THREE.MeshBasicMaterial({
      color: LIFE_COLOR[tone], map: glowTexture(), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }
  return GLOW_MATS[tone];
}
// 灯りそのものより気持ち手前に置くと球の縁が滲みに溶ける（真後ろだと球の輪郭が硬いまま残る）。
const Glow = ({ tone }) => <mesh geometry={GLOW_GEO} material={glowMat(tone)} position={[0, 0, 0.005]} />;

const cap = (t) => (t === "opp" ? "Opp" : "Self");

// 段数を MAX_ROWS で頭打ちにしたときの列数。
const colsFor = (count, columns) => Math.max(columns, Math.ceil(count / MAX_ROWS));

// ポットの粒1つ。**出どころから滑って来る。**
// 差分を追いかけて「飛んでいる粒」を別に作るのではなく、粒ごとに自分の出発点を持たせて
// マウント時に一度だけ寄せる——取りこぼしが原理的に起きず、盤面の値だけが情報源になる
// （旧実装のチップ移動は持ち点の差分から導出していて、1回でも観測を落とすとずれ続けた）。
function SlidingToken({ from, to, tone, delay = 0, enabled }) {
  const ref = useRef(null);
  const startRef = useRef(null);
  // 滑り終えた後に `to` が変われば次のフレームで瞬間移動する。**それを起こさないのは
  // 呼び出し側の責任**——PotLights3D は「既に置いた粒の着地点が二度と動かない」配置にしてある。
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    if (!enabled) { g.position.set(to[0], to[1], 0.06); return; }
    if (startRef.current == null) startRef.current = performance.now() + delay;
    const t = clamp01((performance.now() - startRef.current) / SLIDE_MS);
    const e = easeOutCubic(t);
    g.position.set(
      from[0] + (to[0] - from[0]) * e,
      from[1] + (to[1] - from[1]) * e,
      // **フェルトの上を滑らせること。** 弧を描いて宙を舞うのはカジノでは事故の時だけで、
      // 賭けも払い出しも卓の上を滑る動作しかない。浮きはZファイティングを避ける分だけ。
      0.06,
    );
  });
  return (
    <group ref={ref} position={from}>
      <mesh geometry={BODY_GEO} material={MATS[`lit${cap(tone)}`]} />
      <Glow tone={tone} />
    </group>
  );
}

// ポットに積まれた灯り。selfStaked / oppStaked は「各自がポットへ出した数」で、
// 合計がポットの額そのものになる（2箇所で別々に数えないための形）。
//
// **自分の分と相手の分は別々の帯に置くこと。** 1本の列に通し番号で並べると、こちらが
// レイズして粒が増えるたびに**相手の粒の番号がずれて位置が変わり、既に置かれた粒が
// 卓の上を瞬間移動する**（実際にそうなっていた）。帯を分ければ、片方が増えてももう一方は
// 1粒も動かない。副次的に「いま自分がいくら出しているか」が絵として読めるようにもなる。
// winner: "self" | "opp" を渡すと**払い出し**に切り替わる。積まれた粒が置かれた場所から
// 勝者の側へ滑り、色も勝者の色になる。渡さない間は今までどおり（賭けが積まれるだけ）。
export function PotLights3D({ anchor, selfAnchor, oppAnchor, selfStaked = 0, oppStaked = 0, columns = 4, winner = null }) {
  const reduceMotion = useReduceMotion3D();
  if (!anchor || selfStaked + oppStaked === 0) return null;

  // 出発点はポットのローカル座標系に直す（各アンカーは同じワールド空間にあるので差を取ればよい）。
  const originOf = (a) => (a ? [
    (a.position[0] - anchor.position[0]) / anchor.scale,
    (a.position[1] - anchor.position[1]) / anchor.scale,
    0,
  ] : [0, 0, 0]);

  // 相手の帯は上（相手側）、自分の帯は下（自分側）。**中央線を挟んで向かい合う**ので、
  // どちらが出した分かを覚えなくても、卓のどちら側から来たかで分かる。
  //
  // **段は中央線から外へ向かって伸ばす。** 格子を中央寄せにすると段が増えたときに全体が
  // ずれて、既に置いた粒まで動いてしまう。中央側の1段目を固定すれば、増えるのは外側だけ
  // ——ついでに2つの帯が段数に関わらず絶対に重ならない。
  const band = (n, tone, originAnchor, dir) => {
    if (n <= 0) return null;
    const cols = colsFor(n, columns);
    const from = originOf(originAnchor);
    const w = (cols - 1) * GAP;
    const winAnchor = winner === "self" ? selfAnchor : winner === "opp" ? oppAnchor : null;
    const payTo = winAnchor ? originOf(winAnchor) : null;
    return Array.from({ length: n }, (_, i) => {
      const seat = [(i % cols) * GAP - w / 2, dir * (GAP * 0.55 + Math.floor(i / cols) * GAP), 0];
      // 払い出し: 置かれた場所から勝者の側へ滑らせ、色も勝者の色へ変える。
      // **key を変えて置き直すこと。** SlidingToken は「マウント時に一度だけ滑る」作りなので、
      // to を差し替えるだけでは次のフレームで瞬間移動する（同ファイルの注記のとおり）。
      // 置き直せば「粒ごとに自分の出発点を持ってマウント時に一度だけ寄せる」という
      // 元の仕組みにそのまま乗る——差分を追いかける処理を1行も足さずに済む。
      if (payTo) {
        return (
          <SlidingToken key={`pay-${tone}-${i}`} from={seat} to={payTo}
            tone={winner} delay={i * 30} enabled={!reduceMotion} />
        );
      }
      return (
        <SlidingToken
          // keyは「出どころ＋その帯の中の通し番号」。帯が分かれているので、
          // 相手が積んでもこちらの番号は動かない。
          key={`${tone}-${i}`}
          from={from}
          to={seat}
          tone={tone}
          delay={i * 45}
          enabled={!reduceMotion}
        />
      );
    });
  };

  return (
    <group position={anchor.position} scale={anchor.scale}>
      {band(oppStaked, "opp", oppAnchor, 1)}
      {band(selfStaked, "self", selfAnchor, -1)}
    </group>
  );
}
