// 旧LayeredSVG3D(client/src/LayeredSVG3D.jsx)からCanvas/ライティング/環境マップ/ContactShadowsを
// 除いた「メッシュ描画部分だけ」を独立させたコンポーネント。対戦画面では1画面に付き1つの<Canvas>
// (three/SceneCanvas.jsx)だけを持ち、その中に複数の<Card3D>/<Table3D>(内部でこのSvgMesh3Dを使う)を
// 子として並べる設計にするため、Canvas/ライトはコンポーネント単位で持たせない。
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSharedLayers } from "./geometryCache.js";
import { loadSharedTexture, buildSharedHeightTexture } from "./materialCache.js";

const DEFAULT_MATERIAL = { metalness: 0.15, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.25, emissiveIntensity: 0 };

function TexturedMesh({ geometry, mat, castShadow, receiveShadow }) {
  const [texture, setTexture] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadSharedTexture(mat.texture).then((tex) => {
      if (!cancelled) setTexture(tex);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [mat.texture]);

  if (!texture) return null;
  return (
    <mesh geometry={geometry} castShadow={castShadow} receiveShadow={receiveShadow}>
      <meshPhysicalMaterial
        map={texture}
        metalness={mat.metalness}
        roughness={mat.roughness}
        clearcoat={mat.clearcoat}
        clearcoatRoughness={mat.clearcoatRoughness}
        envMapIntensity={1.4}
      />
    </mesh>
  );
}

// イラストに凹凸をつける。高分割PlaneGeometry(96x96セグメント)を
// 対象シェイプのバウンディングボックスに合わせて作り、ぼかし済み高さテクスチャをdisplacementMap+
// bumpMapの二重掛けで質感を作る。
function ReliefMesh({ geometry, mat, castShadow, receiveShadow, depth }) {
  const [texture, setTexture] = useState(null);
  const [heightTexture, setHeightTexture] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadSharedTexture(mat.texture).then((tex) => {
      if (cancelled) return;
      setTexture(tex);
      setHeightTexture(buildSharedHeightTexture(tex.image, mat.texture));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [mat.texture]);

  const planeGeometry = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const w = box.max.x - box.min.x;
    const h = box.max.y - box.min.y;
    const cx = (box.max.x + box.min.x) / 2;
    const cy = (box.max.y + box.min.y) / 2;
    const geo = new THREE.PlaneGeometry(w, h, 96, 96);
    geo.translate(cx, cy, depth);
    return geo;
  }, [geometry, depth]);

  // このgeometryはgeometryCacheの共有対象外の使い捨て(PlaneGeometryをMemo内で毎回生成)なので、
  // アンマウント時に確実にdisposeする(共有ジオメトリではないためref-count管理は不要)。
  useEffect(() => () => planeGeometry.dispose(), [planeGeometry]);

  if (!texture || !heightTexture) return null;
  const displacementScale = mat.displacementScale ?? 0.4;
  return (
    <mesh geometry={planeGeometry} castShadow={castShadow} receiveShadow={receiveShadow}>
      <meshPhysicalMaterial
        map={texture}
        displacementMap={heightTexture}
        displacementScale={displacementScale}
        displacementBias={mat.displacementBias ?? -displacementScale / 2}
        bumpMap={heightTexture}
        bumpScale={mat.bumpScale ?? 0.1}
        metalness={mat.metalness}
        roughness={mat.roughness}
        clearcoat={mat.clearcoat}
        clearcoatRoughness={mat.clearcoatRoughness}
        envMapIntensity={1.2}
      />
    </mesh>
  );
}

function FlatMesh({ geometry, mat, color, castShadow, receiveShadow }) {
  return (
    <mesh geometry={geometry} castShadow={castShadow} receiveShadow={receiveShadow}>
      <meshPhysicalMaterial
        color={color}
        metalness={mat.metalness}
        roughness={mat.roughness}
        clearcoat={mat.clearcoat}
        clearcoatRoughness={mat.clearcoatRoughness}
        emissive={color}
        emissiveIntensity={mat.emissiveIntensity}
        envMapIntensity={1.4}
      />
    </mesh>
  );
}

// カードは薄い平板なので、真横(エッジ)を向く角度まで回すと「ただの線」に見えてしまう。
// フルスピンではなく正面付近でゆっくり往復するswingにして、常にパーツの色分けが見える角度を保つ。
// swing=falseの場合(対戦画面の実カード等、常時揺れていると見づらい用途)は静止させる。
function SwingGroup({ speed = 0.35, range = 0.38, tiltX = 0, swing = true, children }) {
  const ref = useRef(null);
  const t = useRef(0);
  useFrame((_, delta) => {
    if (!ref.current) return;
    if (swing) {
      t.current += delta * speed;
      ref.current.rotation.y = Math.sin(t.current) * range;
    }
    ref.current.rotation.x = tiltX;
  });
  return <group ref={ref}>{children}</group>;
}

// position/rotationは呼び出し元(Card3D/Table3D)が対戦画面上のレイアウトに応じて渡す
// (フェーズ1のDOMアンカー同期で使う、フェーズ0では固定値で良い)。
export function SvgMesh3D({
  svg, depth = 6, layerGap = 3, bevelSize = 0.5, tiltX = 0, swing = true,
  materialByColor = {},
  position = [0, 0, 0], rotation = [0, 0, 0], groupScale,
}) {
  const { layers, center, scale } = useSharedLayers(svg, depth, layerGap, bevelSize);
  const finalScale = groupScale ?? scale;
  return (
    <group position={position} rotation={rotation}>
      <SwingGroup tiltX={tiltX} swing={swing}>
        {/* scale.yを負にしてSVGのY-down座標系をThreeのY-upに変換している。position(平行移動)は
            自分自身のscaleでなく親空間の単位で加算されるため、Y成分だけ符号を反転させないと
            中心合わせがずれる(実際に踏んだ不具合、詳細はLayeredSVG3D.jsxのコメント参照)。 */}
        <group scale={[finalScale, -finalScale, finalScale]} position={[-center.x * finalScale, center.y * finalScale, -center.z * finalScale]}>
          {layers.map((layer, i) => {
            const mat = { ...DEFAULT_MATERIAL, ...(materialByColor[layer.color.toLowerCase()] || {}) };
            const Mesh = mat.relief ? ReliefMesh : mat.texture ? TexturedMesh : FlatMesh;
            return (
              <group key={i} position={[0, 0, layer.z]}>
                {layer.geometries.map((geo, j) => (
                  <Mesh key={j} geometry={geo} mat={mat} color={layer.color} depth={depth} castShadow receiveShadow />
                ))}
              </group>
            );
          })}
        </group>
      </SwingGroup>
    </group>
  );
}
