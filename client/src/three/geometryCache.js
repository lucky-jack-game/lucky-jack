// 対戦画面では同じ設計のカード(同じ数字・裏面・KING/JOKER宣言札)が自分の場札・相手の場札・複数の
// 手札スロットに何度も登場する。旧LayeredSVG3D(client/src/LayeredSVG3D.jsx)はコンポーネントが
// 呼ばれるたびに独立してSVGLoader.parse→ExtrudeGeometry生成をやり直していたが、同一SVG設計(=同一key)
// ならジオメトリはthree.js側で複数の<mesh>から共有できる(BufferGeometryは参照を共有してよい)。
// ref-countで「今何個のCard3D/Table3Dがこのジオメトリを使っているか」を数え、0になってから猶予を置いて
// dispose()する。猶予が無いとReact StrictModeの開発時二重マウント(mount→cleanup→再mount)や、
// 対戦中の再レンダーで一瞬refCountが0になる場合に誤って即破棄してしまう。
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

const cache = new Map(); // key -> { layers, center, scale, refCount, disposeTimer }
const DISPOSE_GRACE_MS = 300;

function buildLayers(svgString, depth, layerGap, bevelSize) {
  const loader = new SVGLoader();
  const data = loader.parse(svgString);
  const extrudeSettings = { depth, bevelEnabled: true, bevelThickness: bevelSize, bevelSize, bevelSegments: 6, curveSegments: 24 };

  const layers = data.paths.map((path, i) => {
    const shapes = path.toShapes(true);
    const geometries = shapes.map((shape) => {
      const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geo.computeVertexNormals();
      return geo;
    });
    // Color.getStyle()は"rgb(r,g,b)"形式を返すため、materialByColorのキー(hex文字列)と一致しない。
    // getHexString()を使い、SVG側のfill hex表記とそのまま突き合わせられるようにする。
    return { geometries, color: `#${path.color.getHexString()}`, z: i * layerGap };
  });

  // 全レイヤー合算のバウンディングボックスを求めて中央寄せ・正規化スケールを出す。
  const box = new THREE.Box3();
  layers.forEach((layer) => layer.geometries.forEach((geo) => {
    geo.computeBoundingBox();
    box.union(geo.boundingBox);
  }));
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 4 / maxDim;

  return { layers, center, scale };
}

// svgStringそのものをキーの一部に使う(数十枚規模のユニークなカード意匠しか存在しないため、文字列の
// 長さそのものはボトルネックにならない。ハッシュ化までは不要と判断)。
export function useSharedLayers(svgString, depth, layerGap, bevelSize) {
  const key = `${svgString}|${depth}|${layerGap}|${bevelSize}`;

  // 「無ければ作る」はrender中に行うが、Map.has()チェックがあるため、Reactが同じ呼び出しを複数回
  // 実行しても(StrictMode等)2回目以降はキャッシュを読むだけで再生成は起きない。
  const entry = useMemo(() => {
    let e = cache.get(key);
    if (!e) {
      const built = buildLayers(svgString, depth, layerGap, bevelSize);
      e = { ...built, refCount: 0, disposeTimer: null };
      cache.set(key, e);
    }
    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    entry.refCount += 1;
    if (entry.disposeTimer) {
      clearTimeout(entry.disposeTimer);
      entry.disposeTimer = null;
    }
    return () => {
      entry.refCount -= 1;
      if (entry.refCount <= 0) {
        entry.disposeTimer = setTimeout(() => {
          if (entry.refCount <= 0 && cache.get(key) === entry) {
            entry.layers.forEach((layer) => layer.geometries.forEach((geo) => geo.dispose()));
            cache.delete(key);
          }
        }, DISPOSE_GRACE_MS);
      }
    };
  }, [entry, key]);

  return entry; // { layers, center, scale }
}

// デバッグ/検証用(フェーズ0のPlaywright検証で「ユニーク意匠数どおりに収まっているか」を確認するため)。
export function getGeometryCacheSize() {
  return cache.size;
}
