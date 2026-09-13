// three/domAnchors.jsx(DOM→3D、unproject())の数学的な逆演算。3D主導の設計に転換したことで、
// 位置の正はthree/layoutAnchors.jsの固定ワールド座標になった。DOM側(自分/相手の名前パネル等)は
// このワールド座標をcamera.project()でスクリーン座標に変換した結果に追従する。
// useThree()/useFrame()を使うため、必ず<SceneCanvas>の子(Canvasの内側)でマウントすること。
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const EPSILON = 0.5; // px単位。この程度の変化は無視し、DOM側の不要な再レンダーを避ける。

// 実際に踏んだ不具合(canvasサイズの二重zoom適用と同根): canvasRect(getBoundingClientRect())は
// 既にCSS `zoom`(.kj-app-shell、PC横長で1.2〜1.6倍)込みの実寸pxを返す。この実寸pxをそのまま
// left/topのinline style値として、同じzoom:1.4の祖先の中にあるDOM要素へ設定すると、ブラウザが
// その値を「未zoomのCSS px」とみなして描画時にさらにzoom倍してしまい、中心から離れたパネル
// (座標の絶対値が大きい)ほど実際の描画位置が指数関数的にズレる(自分/相手パネルが場札に
// 重なって見えるバグの直接原因)。解決策は、computeした実寸pxを事前にzoom係数で割っておくこと
// (ブラウザが描画時にzoom倍しても、割り戻した分だけ相殺されて正しい実寸位置になる)。
// zoom自体は`.kj-app-shell`にのみ設定されており(入れ子でzoomが重なることはない)、要素自身の
// computed `zoom`はここでは常に1を返す(zoomはCSSプロパティとして子孫に「伝播」するのではなく
// 描画スケールとして働くため)、祖先を直接クエリして読む必要がある。
export function getAppShellZoom() {
  if (typeof document === "undefined") return 1;
  const shell = document.querySelector(".kj-app-shell");
  if (!shell) return 1;
  const z = parseFloat(getComputedStyle(shell).zoom);
  return Number.isFinite(z) && z > 0 ? z : 1;
}

function projectToScreen(vec3, camera, canvasRect, zoom) {
  const p = vec3.clone().project(camera); // NDC [-1, 1]
  return {
    x: ((p.x * 0.5 + 0.5) * canvasRect.width) / zoom,
    y: ((1 - (p.y * 0.5 + 0.5)) * canvasRect.height) / zoom,
  };
}

function layoutsEqual(a, b) {
  if (!a || !b) return false;
  for (const key of Object.keys(a)) {
    if (!b[key]) return false;
    if (Math.abs(a[key].x - b[key].x) > EPSILON) return false;
    if (Math.abs(a[key].y - b[key].y) > EPSILON) return false;
  }
  return true;
}

// anchors: three/layoutAnchors.jsのcomputeBattleLayout()の戻り値(self/opp/kj/selfPanel/oppPanel等、
// 各{position:[x,y,z]}を持つオブジェクト)。position/カメラは固定値なので、スクリーン座標が変わるのは
// canvas.getBoundingClientRect()が変わる時(リサイズ・向き変更・PC横長zoomのメディアクエリ切り替わり・
// 文字サイズ設定変更)だけ。毎フレーム計算はするが、前回値と実質的に変化がなければonLayoutを呼ばない
// (domAnchors.jsxのAnchoredGroupの初回initializedガードと同じ思想。ただしDOMパネルは滑らかに動く
// 必要がないため、lerpではなく差分検知でスナップさせる)。定常状態ではマウント時に1回発火してからは
// ほぼ呼ばれなくなるため、毎フレームの計算コスト(Vector3.project()数回)自体は無視できる。
export function AnchorProjector({ anchors, onLayout }) {
  const { camera, gl } = useThree();
  const lastRef = useRef(null);

  useFrame(() => {
    const canvasRect = gl.domElement.getBoundingClientRect();
    if (canvasRect.width === 0 || canvasRect.height === 0) return;
    const zoom = getAppShellZoom();

    const next = {};
    for (const key of Object.keys(anchors)) {
      const entry = anchors[key];
      if (!entry || !Array.isArray(entry.position)) continue;
      const vec = new THREE.Vector3(...entry.position);
      next[key] = projectToScreen(vec, camera, canvasRect, zoom);
    }

    if (!layoutsEqual(lastRef.current, next)) {
      lastRef.current = next;
      onLayout?.(next);
    }
  });

  return null;
}
