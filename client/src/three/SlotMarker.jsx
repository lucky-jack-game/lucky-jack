// カードが配られる場所を示す卓上の目印。以前はthree/tableSvgBuilders.jsの卓SVGに固定座標で
// 焼き込んでいたが、実際のカードは(当時)DOM要素の位置に追従する別の座標系で動いていたため、
// 2つの独立した座標系がズレる不具合があった(three/layoutAnchors.jsのコメント参照)。この目印は
// Card3Dと同じ<group>(three/layoutAnchors.jsの固定ワールド座標)の中で描画することで、
// 常にカードと完全に同じ位置・スケールになる(構造的にズレが起こり得ない)。
import { useMemo } from "react";
import * as THREE from "three";

function roundedRectShape(w, h, r) {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

// width/heightはカード本体(Card3D)より一回り大きくして縁取りのように見せる。
// z=-0.3でカードのわずかに奥に置く。
export function SlotMarker({ width, height, accentColor = "#caa452", feltColor = "#0f3d2e" }) {
  const outerShape = useMemo(() => roundedRectShape(width, height, Math.min(width, height) * 0.1), [width, height]);
  const innerShape = useMemo(
    () => roundedRectShape(width - 0.16, height - 0.16, Math.min(width, height) * 0.08),
    [width, height],
  );
  return (
    <group position={[0, 0, -0.3]}>
      <mesh position={[0, 0, 0]}>
        <shapeGeometry args={[outerShape]} />
        <meshStandardMaterial color={accentColor} roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <shapeGeometry args={[innerShape]} />
        <meshStandardMaterial color={feltColor} roughness={0.9} metalness={0} />
      </mesh>
    </group>
  );
}
