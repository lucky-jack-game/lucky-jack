// 対戦画面以外（スキン画面・ショップの3Dプレビュー・報酬ボックスの開封・ホームの卓）で使う、単一Canvasの3Dショーケース。
//
// 対戦画面(three/BattleScene3D.jsx)は「卓・場札・手札・パネルが同じ座標系で噛み合う」ことが要件
// だったためレイアウト計算が重いが、ショーケースは見せたい物が1〜6点あるだけなので、
// 「デザイン単位で素直に並べて、可視範囲に収まるよう全体を1回スケールする」だけで足りる。
// この`FitGroup`が、対戦画面で学んだ「固定ワールド座標の表ではなく、使える領域からの逆算」を
// ショーケース向けに最小化したもの。画面幅やCSS zoomが
// どうであれ中身がはみ出さないことが構造的に保証される。
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SceneCanvas } from "./SceneCanvas.jsx";
import { Card3D } from "./Card3D.jsx";
import { Table3D } from "./Table3D.jsx";
import { SlotMarker } from "./SlotMarker.jsx";
import { TABLE_SVG } from "./tableSvgBuilders.js";
import { useReduceMotion3D } from "./useReduceMotion3D.js";
import { getHaloTexture } from "./materialCache.js";
import { getCardPalette3D } from "../CardArt.jsx";
import { getTablePalette3D } from "../TableArt.jsx";

// 見本の3D（スキン・ショップ・ボックス開封）は、**端末に関わらず表示の2倍の細かさで描く。**
// 既定の dpr [1,2] は端末の画素密度に従うので、スマホ（dpr 3 → 2で頭打ち）は2倍で描くのに、
// 画素密度1のPCモニタは1倍で描いていた——同じ札の縁や映り込みがPCだけ粗くなり、
// 「PCとスマホで見え方が違う。スマホのほうがいい」の一因になっていた。
// 枠は小さい（最大でも 800×300 程度）ので、2倍にしても描く量は対戦画面の卓より少ない。
const SHOWCASE_DPR = 2;

// Card3Dはscale=1のとき幅2.82・高さ4（three/geometryCache.jsが最大寸法を4に正規化する）。
const CARD_W = 2.82;
const CARD_H = 4;

// cover=false（既定）は「収める」＝はみ出さない。見せたい物が主役の画面はこちら。
// cover=true は「覆う」＝枠を埋め、あふれた分は親の overflow:hidden で切る（CSSの
// background-size: cover と同じ）。**背景として敷く物だけに使う**——背景に敷く卓は
// 横長のパネルに敷くので、収める側だと高さで頭打ちになり、卓が中央に小さく浮いてしまう
// （PC幅で実際にそう見えた）。
function FitGroup({ contentWidth, contentHeight, padding = 0.88, cover = false, children }) {
  const { viewport } = useThree();
  const sx = (viewport.width * padding) / contentWidth;
  const sy = (viewport.height * padding) / contentHeight;
  return <group scale={cover ? Math.max(sx, sy) : Math.min(sx, sy)}>{children}</group>;
}

// レア度/スキンの色でカードの背後をほのかに光らせるハロー。強い発光を面全体に乗せると
// 対戦画面で踏んだ「白飛び」と同じ失敗になるため、あくまで背後に置いた板に留め、
// カード自体のマテリアルには一切触れない。
//
// 単色の円盤(circleGeometry+meshBasicMaterial)だと縁がくっきり出て「光」ではなく
// 「灰色の丸い板」に見えてしまう（実際にそう見えた）。中心から外へ透明に抜ける絵（getHaloTexture）を貼る。
//
// **板は描画領域（canvas）の内側で透明まで落ちきる大きさにすること。** 以前は半径3.6の固定値を
// FitGroup の内側に置いていたので、ショップの3Dプレビュー（168×210px）やボックス開封のように枠が
// 小さい所では板が canvas より大きくなり、光が**四角い縁で切り落とされて**見えていた。
// 大きさは見えている範囲
// （viewport）から決め、FitGroup の外に置く。viewport は z=0 の面での値で、板はそれより奥にあるので
// 同じ半径でも少し小さく映る＝縁までに余裕が残る。
function AccentHalo({ color, opacity = 0.5 }) {
  const map = useMemo(() => getHaloTexture(), []);
  const viewport = useThree((s) => s.viewport);
  const radius = Math.min(viewport.width, viewport.height) / 2;
  return (
    <mesh position={[0, 0, -1.6]}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <meshBasicMaterial
        map={map} color={color} transparent opacity={opacity}
        blending={THREE.AdditiveBlending} depthWrite={false}
      />
    </mesh>
  );
}

// ゆっくり上下に漂う＋わずかに首を振る。ショーケースは「見せる」ための画面なので、
// 対戦画面の場札(静止)とは逆に常時わずかに動かして立体であることを伝える。
function FloatGroup({ amplitude = 0.16, speed = 1.1, phase = 0, children }) {
  const ref = useRef(null);
  const reduceMotion = useReduceMotion3D();
  useFrame(({ clock }) => {
    if (!ref.current || reduceMotion) return;
    ref.current.position.y = Math.sin(clock.getElapsedTime() * speed + phase) * amplitude;
  });
  return <group ref={ref}>{children}</group>;
}

// ── カード1枚のショーケース（スキン画面のヒーロー枠／ボックス開封の結果表示） ──
// rotation: { x, y }（ラジアン）を渡すと、その角度で固定して見せる。触って角度を変えられる
// プレビュー用（ショップ）。**角度はDOM側が持つ**——ポインタの取り回し（capture・慣性・
// クリックとの区別）はDOMの仕事で、ここに持たせると three.js のチャンクに入ってしまう。
// 渡された時は自動の首振り(swing)と漂い(FloatGroup)を止める：手で回している物が勝手に動くと、
// 自分の操作の結果なのか分からなくなる。
export function CardShowcase3D({
  theme = "classic", variant = "number", number = 5, special, declaration,
  faceDown = false, accentColor, style, rotation,
}) {
  const reduceMotion = useReduceMotion3D();
  const halo = accentColor || getCardPalette3D(theme).emblemColor;
  const card = (
    <Card3D
      theme={theme} variant={variant} number={number} special={special}
      declaration={declaration} faceDown={faceDown} swing={!reduceMotion && !rotation}
    />
  );
  return (
    <SceneCanvas
      cameraZ={9} style={style} contactShadowY={-2.9} envIntensity={0.95} dpr={SHOWCASE_DPR}
      frontFill={{ position: [0, 7, 9], intensity: 0.4 }}
    >
      {/* ハローは FitGroup の外（大きさを canvas の見えている範囲から決めるため。AccentHalo の注記） */}
      <AccentHalo color={halo} />
      <FitGroup contentWidth={CARD_W * 1.45} contentHeight={CARD_H * 1.2}>
        {rotation
          ? <group rotation={[rotation.x, rotation.y, 0]}>{card}</group>
          : <FloatGroup>{card}</FloatGroup>}
      </FitGroup>
    </SceneCanvas>
  );
}

// ── 卓のショーケース（スキン画面のテーブルタブ／ショップの3Dプレビュー） ──
// **対戦画面と同じく正面向きに置く。倒さないこと。** 以前は「家具として奥行きが分かるように」
// 0.34rad 倒していたが、一覧の中で卓だけが傾いて見え、しかも装備した後に対戦で見る卓（正対）と角度が違うので、
// 「装備するとこう見える」の見本になっていなかった。
// 実際に置かれるカードの目印も一緒に描き、「装備するとこう見える」が分かるようにする。
export function TableShowcase3D({ theme = "classic", cardTheme = "classic", style, rotation }) {
  const palette = getTablePalette3D(theme);
  // 触って回す時（ショップ）は、正面を起点に手で動かした角度だけ傾ける。
  const tilt = rotation ? [rotation.x, rotation.y, 0] : [0, 0, 0];
  const tableW = 4 * (420 / 420); // 卓SVGは420×215、最大寸法が4に正規化される（＝幅4）
  const tableH = 4 * (215 / 420);
  return (
    <SceneCanvas cameraZ={9} style={style} contactShadowY={-1.6} envIntensity={1.1} dpr={SHOWCASE_DPR}>
      {/* 卓は横長なので、収まり計算の高さに余裕を持たせすぎると幅が余って小さく見える。
          正面向きなので、足すのは縁の厚みと影のぶんだけでよい。 */}
      <FitGroup contentWidth={tableW * 1.02} contentHeight={tableH * 1.12}>
        <group rotation={tilt}>
          <Table3D theme={theme} />
          {/* 卓上に置かれるカードの見え方（目印＋伏せ札）まで含めて1枚の絵にする。
              正面向きなので卓の中心の高さに置き、卓の面からは少しだけ浮かせる（ロビーの主卓と同じ 0.12）。 */}
          <group position={[0, 0, 0.12]}>
            {[-0.95, 0.95].map((x) => (
              <group key={x} position={[x, 0, 0]} scale={0.26}>
                <SlotMarker width={3.3} height={4.6} accentColor={palette.trim} feltColor={palette.felt} />
                <Card3D theme={cardTheme} faceDown />
              </group>
            ))}
          </group>
        </group>
      </FitGroup>
    </SceneCanvas>
  );
}

// ── ロビーの主卓（ホーム画面。client/src/LobbyArt.jsx が lazy で読む） ──
// 対戦で使う卓・札そのもの（Table3D / Card3D / SlotMarker）を、展示台に据えた一品として見せる。
// 卓は対戦画面（正対）と違い、家具として斜め上から見下ろす角度に倒す——ロビーで斜めに見ていた卓を、
// 対戦に入ると正面から見る、という連続性になる。
//
// **描き続けないこと。** ホームは滞在時間が最も長い画面なのに、動く物は入場の演出の Queen のめくり
// だけ。その間だけ "always" にし、あとは "demand"（何かが変わった時だけ描く）に落とす。
const LOBBY_TILT = 0.95;       // rad。卓の奥の辺を向こうへ倒す
// 札の高さ＝卓の高さの約4割（2D版 lobby.css の .kj-lobby-seat と揃える）。主役は Queen なので
// 読める大きさを優先するが、札の端がフェルトの内側（半高1.085）に収まる上限がこの組み合わせ
// （0.58 + 札の半高0.48 = 1.06）。これ以上大きくするとレールに乗り上げる。
const LOBBY_CARD_SCALE = 0.24;
const LOBBY_SEAT_Y = 0.58;     // 奥（相手）と手前（自分）の場札の位置
const LOBBY_FLIP_SETTLE_MS = 900; // めくり(Card3D の FLIP_DURATION_MS=380)が終わるまで毎フレーム描く

// demand に落とすと、テクスチャ（Queenの絵）や環境マップの読み込みが済む前のコマで絵が止まりうる。
// 読み込みが落ち着くまでの短い間だけ、間引いて描き直させる保険。
function SettleFrames({ ms = 2500, every = 150 }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = setInterval(() => invalidate(), every);
    const stop = setTimeout(() => clearInterval(id), ms);
    return () => { clearInterval(id); clearTimeout(stop); };
  }, [invalidate, ms, every]);
  return null;
}

// introPhase: "wait"（タイトル画面の裏）| "play"（入場の演出中）| "done"。
// revealMs: 演出の開始から Queen をめくるまで（LobbyScreen.jsx の LOBBY_INTRO.reveal。音と同じ値）。
export function LobbyTable3D({ theme = "classic", cardTheme = "classic", introPhase = "done", revealMs = 1950, style }) {
  const palette = getTablePalette3D(theme);
  const [revealed, setRevealed] = useState(introPhase === "done");
  const [settled, setSettled] = useState(introPhase === "done");
  useEffect(() => {
    if (introPhase === "done") { setRevealed(true); return undefined; }
    if (introPhase !== "play") return undefined;
    const t = setTimeout(() => setRevealed(true), revealMs);
    return () => clearTimeout(t);
  }, [introPhase, revealMs]);
  useEffect(() => {
    if (!revealed || settled) return undefined;
    const t = setTimeout(() => setSettled(true), LOBBY_FLIP_SETTLE_MS);
    return () => clearTimeout(t);
  }, [revealed, settled]);

  // 演出を途中で飛ばされた時（play→done）も、めくりが終わるまでは毎フレーム描く。
  // demand のまま飛ばすと Card3D の useFrame が回らず、Queen が伏せたまま止まる。
  const frameloop = introPhase !== "wait" && !settled ? "always" : "demand";
  const tableW = 4;
  const tableH = 4 * (TABLE_SVG.landscape.height / TABLE_SVG.landscape.width);
  const seats = [
    { y: LOBBY_SEAT_Y, card: { faceDown: true } },
    { y: -LOBBY_SEAT_Y, card: { variant: "number", number: 10, special: "king", faceDown: !revealed } },
  ];
  return (
    <SceneCanvas
      cameraZ={9} style={{ pointerEvents: "none", ...style }}
      frameloop={frameloop} dpr={[1, 1.5]}
      contactShadowY={-1.3} contactShadowOpacity={0.7} envIntensity={1.05}
      ambient={0.32} keyIntensity={1.8} frontFill={{ position: [5, 4, 8], intensity: 0.6 }}
      rimColor="#ffc98a" hemiSky="#3b2a17" envAccent="#8b5a2b"
    >
      <SettleFrames />
      {/* 壁龕の頂のペンダント灯（CSS）に合わせた、真上からの暖色の灯り */}
      <pointLight position={[0, 2.6, 3.2]} intensity={10} distance={12} decay={2} color="#ffe2b0" />
      {/* **FitGroup の「収める」はカメラから z=0 の平面で測っている。** 卓を倒すと手前の縁がカメラへ
          寄り、遠近でそのぶん大きく映る——倒した見かけの高さ(cos)だけで収めた初版は、手前の縁が
          約1.7倍に広がって壁龕の左右と手前で切れていた。高さに余裕を取って拡大率を落とし、
          手前の縁の拡大を1.3倍程度に抑える（そのとき卓の手前の縁がちょうど台座の天板に載る）。 */}
      <FitGroup contentWidth={tableW * 1.1} contentHeight={tableH * 1.25} padding={0.96}>
        <group rotation={[-LOBBY_TILT, 0, 0]}>
          <Table3D theme={theme} />
          {seats.map(({ y, card }) => (
            <group key={y} position={[0, y, 0.12]} scale={LOBBY_CARD_SCALE}>
              <SlotMarker width={3.3} height={4.6} accentColor={palette.trim} feltColor={palette.felt} />
              <Card3D theme={cardTheme} {...card} />
            </group>
          ))}
        </group>
      </FitGroup>
    </SceneCanvas>
  );
}
