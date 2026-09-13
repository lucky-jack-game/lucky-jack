// 色+質感(metalness/roughness/clearcoat等)のプリセットはJSオブジェクトとしては軽量で、
// three.js/WebGLレンダラー側もマテリアルの「レシピ」(プロパティの組み合わせ)が同じであれば
// シェーダープログラムを内部的に使い回すため、MeshPhysicalMaterialインスタンス自体を手動でプールする
// 必要は薄い。重量級なのはネットワーク経由のテクスチャ読み込みとcanvas処理の方なので、
// このファイルはそちらだけを共有キャッシュする。
import * as THREE from "three";

const textureCache = new Map(); // url -> Promise<THREE.Texture>
const heightTextureCache = new Map(); // url -> THREE.CanvasTexture

// 対戦画面では同じイラスト付き特殊札(QUEEN/KING/JOKER)が複数箇所に出うるため、
// 同じURLへの読み込みリクエストは1回だけ発行し、以降は同じPromiseを共有する。
export function loadSharedTexture(url) {
  if (!textureCache.has(url)) {
    const promise = new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          // 親グループがSVGのY-down→Three.jsのY-up変換でscale.yを反転させているため、
          // 標準のflipY=trueのままだと画像が上下逆に描画される(LayeredSVG3D時代に実際に踏んだ不具合)。
          tex.flipY = false;
          tex.needsUpdate = true;
          resolve(tex);
        },
        undefined,
        (err) => {
          console.error("[materialCache] texture load failed:", url.slice(0, 60), err);
          reject(err);
        },
      );
    });
    textureCache.set(url, promise);
  }
  return textureCache.get(url);
}

// 実写調イラストをdisplacementMap/bumpMapにそのまま使うと1ピクセル単位のノイズを拾って
// 「砂嵐」状態になる不具合が過去にあったため、原画を一旦小さなcanvasに縮小描画した
// 「ぼかし済み高さテクスチャ」を別途作る。
// 同じ画像から複数回呼ばれても再計算しないようURLキーでキャッシュする。
export function buildSharedHeightTexture(image, sourceUrl) {
  if (heightTextureCache.has(sourceUrl)) return heightTextureCache.get(sourceUrl);
  const targetLong = 40; // 意図的に低解像度にすることでボケさせる(=大きな凹凸だけ残す)
  const aspect = image.width / image.height;
  const w = aspect >= 1 ? targetLong : Math.max(8, Math.round(targetLong * aspect));
  const h = aspect >= 1 ? Math.max(8, Math.round(targetLong / aspect)) : targetLong;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  heightTextureCache.set(sourceUrl, tex);
  return tex;
}

// ── 光の滲み（bloomの代用）──
// **単色のcircleGeometry/sphereGeometryで光は作れない。** 縁がくっきり出て「光」ではなく
// 「灰色の丸い板」に見える（ショーケースのレア度グロー・トレーラーの吊り灯りの両方で実際に踏んだ）。
// ラジアルグラデーションのテクスチャを1枚だけ作り、加算合成で重ねること。
let haloTexture = null;
export function getHaloTexture() {
  if (haloTexture) return haloTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  haloTexture = new THREE.CanvasTexture(canvas);
  return haloTexture;
}
