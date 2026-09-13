// 対戦画面の卓(フェルトテーブル)のプレゼンテーション。意匠はモバイル/デスクトップ共通で、
// 大きさだけをthree/layoutAnchors.jsのscaleで変える(卓の設計自体はthree/tableSvgBuilders.js参照)。
//
// tiltX(奥行き方向の傾き)は既定で0にしてある: 以前は0.24〜0.28傾けて「奥に倒れた卓」を表現していたが、
// 卓に対して場札・手札のカードは傾かずカメラ正対のままだったため、卓とカードで消失点が食い違い
// 「斜めっている」ように見えた。そこで卓もカードも正対させる。
import { useMemo } from "react";
import { SvgMesh3D } from "./SvgMesh3D.jsx";
import { buildTableSvg } from "./tableSvgBuilders.js";
import { getTablePalette3D } from "../TableArt.jsx";

// theme: 装備中の卓スキンID(TableArt.jsxのTABLE_THEMESのキー、storage.jsのgetEquippedTable()の値)。
// variant: "landscape" | "portrait"。意匠は共通で、viewBoxの高さ(卓の縦横比)だけが変わる
// (three/tableSvgBuilders.jsのTABLE_SVG参照。向きによって卓の大きさを縛る条件が違うため)。
export function Table3D({ theme = "classic", variant = "landscape", position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, tiltX = 0 }) {
  const { svg, materials } = useMemo(() => buildTableSvg(getTablePalette3D(theme), variant), [theme, variant]);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <SvgMesh3D svg={svg} materialByColor={materials} depth={5} layerGap={1.1} bevelSize={0.7} tiltX={tiltX} swing={false} />
    </group>
  );
}
