// 卓に伸びてくる3Dの手（ディーラー／プレイヤーの手）。
//
// 本プロジェクトにはイラスト制作パイプラインが無いため、
// 手のモデルを外部から持ち込むことはできない。カプセル・円柱だけで組んだ**様式化された手**にし、
// 白手袋＋金のカフスというカジノのディーラーの意匠に寄せることで、写実性ではなく
// 「役割が読めること」で成立させる（卓・カードと同じ金／象牙のパレットに載る）。
//
// ── 形の決め方（最初の版が「ミトン」に見えた反省）──
// 初版は手のひらを大きく・指を短く作ったため、卓上の小さいサイズでは指の分離が消えて
// ただの丸い塊に見えた。実際の手は「手のひらの長さ ≒ 指の長さ」で、指の間には
// 必ず隙間が見える。以下の3点を守ること:
//   ・指の長さは手のひらの高さと同程度（PALM_H に対して FINGERS の length はほぼ同じ）
//   ・指の間隔(0.22)は指の直径(0.18)より必ず大きくして、隙間を潰さない
//   ・指をわずかに手前(+Z)へ曲げる。まっすぐだと板に見え、曲げると「掴む手」に見える
//
// ローカル座標系: 手のひらが原点、指先が +Y、手の甲が +Z（カメラ側）、袖が -Y へ伸びる。
// 全体の高さは約 2.2（手のひら1.0 + 指1.2）、幅は約 1.0。呼び出し側はscaleで大きさを決める。
import { useMemo } from "react";
import * as THREE from "three";

const GLOVE = "#ddd0b0";       // 白手袋（純白だと暗い卓の上で浮くので象牙寄り）
const GLOVE_DEEP = "#b8a98a";  // 指の付け根・関節側の陰
const CUFF = "#caa452";        // アンティークゴールドのカフス（卓の金と同族）
const CUFF_EDGE = "#f4e7bf";
const SLEEVE = "#141019";      // 袖（画面外へ抜ける暗色）

const PALM_H = 1.0;
// x位置・長さ・太さ・扇の角度。人差し指〜小指の順に並べる。
const FINGERS = [
  { x: -0.33, length: 0.92, radius: 0.09, tilt: 0.14 },
  { x: -0.11, length: 1.06, radius: 0.092, tilt: 0.04 },
  { x: 0.11, length: 1.0, radius: 0.089, tilt: -0.05 },
  { x: 0.33, length: 0.78, radius: 0.082, tilt: -0.16 },
];

function useHandMaterials() {
  return useMemo(() => ({
    glove: new THREE.MeshPhysicalMaterial({
      color: GLOVE, roughness: 0.66, clearcoat: 0.16,
      sheen: 0.5, sheenColor: new THREE.Color("#fff6e2"),
    }),
    deep: new THREE.MeshPhysicalMaterial({ color: GLOVE_DEEP, roughness: 0.74 }),
    cuff: new THREE.MeshPhysicalMaterial({ color: CUFF, metalness: 0.75, roughness: 0.28 }),
    cuffEdge: new THREE.MeshPhysicalMaterial({ color: CUFF_EDGE, metalness: 0.6, roughness: 0.24 }),
    sleeve: new THREE.MeshPhysicalMaterial({ color: SLEEVE, roughness: 0.88 }),
  }), []);
}

// 指1本。カプセルは中心が原点なので、付け根から length ぶん +Y へ伸びるよう置き直す。
// 第2関節で軽く手前へ折るため、根元と先端を別カプセルに分けている。
function Finger({ x, length, radius, tilt, materials }) {
  const lower = length * 0.55;
  const upper = length * 0.45;
  return (
    <group position={[x, PALM_H * 0.42, 0]} rotation={[0, 0, tilt]}>
      <mesh position={[0, lower / 2, 0]} material={materials.glove} castShadow>
        <capsuleGeometry args={[radius, lower, 3, 10]} />
      </mesh>
      {/* 先端側は手前(+Z)へわずかに折る＝掴む形 */}
      <group position={[0, lower, 0]} rotation={[0.34, 0, 0]}>
        <mesh position={[0, upper / 2, 0]} material={materials.glove} castShadow>
          <capsuleGeometry args={[radius * 0.92, upper, 3, 10]} />
        </mesh>
      </group>
    </group>
  );
}

// side: "self"(手前＝画面下から伸びる) / "opp"(奥＝画面上から伸びる)。
// oppはZ軸まわりに180°回すことで、卓の向こう側から差し出された手になる（左右も反転するので
// 自然に「反対の手」に見える）。
export function Hand3D({ side = "self", ...groupProps }) {
  const mats = useHandMaterials();
  const flip = side === "opp" ? Math.PI : 0;

  return (
    <group {...groupProps}>
      <group rotation={[0, 0, flip]}>
        {/* 手のひら。球ではなく縦長のカプセルを潰して、丸い塊ではなく「板状の甲」にする。 */}
        <mesh position={[0, -0.05, 0]} scale={[1.18, 1, 0.34]} material={mats.glove} castShadow>
          <capsuleGeometry args={[0.36, PALM_H - 0.72, 4, 16]} />
        </mesh>
        {/* 指の付け根（ナックル）。ここが無いと指が板から直接生えて見える。 */}
        <mesh position={[0, PALM_H * 0.4, 0.01]} scale={[1.16, 0.42, 0.34]} material={mats.deep}>
          <sphereGeometry args={[0.36, 16, 12]} />
        </mesh>

        {FINGERS.map((f) => <Finger key={f.x} {...f} materials={mats} />)}

        {/* 親指は手のひらの横から前方(+Z)斜め上へ。手の向きはこれで読ませる。 */}
        <group position={[-0.44, -0.12, 0.1]} rotation={[0.28, 0, 1.05]}>
          <mesh position={[0, 0.24, 0]} material={mats.glove} castShadow>
            <capsuleGeometry args={[0.105, 0.3, 3, 10]} />
          </mesh>
          <group position={[0, 0.42, 0]} rotation={[0.3, 0, -0.3]}>
            <mesh position={[0, 0.16, 0]} material={mats.glove} castShadow>
              <capsuleGeometry args={[0.098, 0.24, 3, 10]} />
            </mesh>
          </group>
        </group>

        {/* 手首の金のカフス（明るい縁取り付き）とその先の袖。袖は必ず画面外へ抜ける長さにして
            「どこかから伸びてきた腕」に見せる（切り口が見えると人形の部品になる）。 */}
        <mesh position={[0, -0.66, 0]} scale={[1.12, 1, 0.44]} material={mats.cuffEdge}>
          <cylinderGeometry args={[0.34, 0.34, 0.07, 20]} />
        </mesh>
        <mesh position={[0, -0.82, 0]} scale={[1.1, 1, 0.44]} material={mats.cuff}>
          <cylinderGeometry args={[0.335, 0.32, 0.28, 20]} />
        </mesh>
        <mesh position={[0, -1.85, 0]} scale={[1.05, 1, 0.44]} material={mats.sleeve}>
          <cylinderGeometry args={[0.31, 0.28, 1.9, 20]} />
        </mesh>
      </group>
    </group>
  );
}
