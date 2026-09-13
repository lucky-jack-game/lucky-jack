// 対戦画面で使う3Dカードのプレゼンテーション。variant("number"|"declaration"|"back")に応じて
// three/cardSvgBuilders.jsからSVG/materialByColorを組み立て、Canvas/ライトを持たないSvgMesh3D
// (three/SvgMesh3D.jsx)に渡すだけの薄いラッパー。CardArt.jsxのPlayingCardと同じ意味論のprops
// (variant/number/special/declaration/faceDown)を踏襲し、呼び出し元(shared.jsx)からの移行を
// 最小限のprop変更で済ませられるようにしている。
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { SvgMesh3D } from "./SvgMesh3D.jsx";
import { buildNumberCardSvg, buildCardBackSvg, buildPortraitCardSvg } from "./cardSvgBuilders.js";
import { getCardPalette3D } from "../CardArt.jsx";

// specialフラグ(shared/engine.jsの内部id)→ポートレート表示名の対応。
// **"king" が QUEEN**（Ⅰにだけ負ける無条件勝利の札）。1対1しか無いが、内部idと表示名が
// 食い違っているので対応表として残す——直に書くと必ず取り違える。
const SPECIAL_TO_PORTRAIT = { king: "queen" };


function buildCardAppearance({ variant, number, special, declaration, faceDown, palette }) {
  if (faceDown) return buildCardBackSvg(palette);
  // KING/JOKER宣言カードは以前は幾何学モチーフ(buildDeclarationCardSvg、削除済み)を使っていたが、
  // QUEENと同じイラスト差し込みパイプライン(buildPortraitCardSvg)にking/joker用の画像
  // (/card-art/king.webp, /card-art/joker.webp)が既に用意されていたため、こちらに統一した
  // (declaration値の"king"/"joker"はSPECIAL_PORTRAIT_CONFIGのキーとそのまま一致する)。
  if (variant === "declaration") return buildPortraitCardSvg(declaration, palette);
  const portraitKind = special && SPECIAL_TO_PORTRAIT[special];
  if (portraitKind) return buildPortraitCardSvg(portraitKind, palette);
  return buildNumberCardSvg(number, palette);
}

const FLIP_DURATION_MS = 380; // shared.jsx旧CardSlotのcardFlip(0.38s)と同じ長さに揃える
const BREATHE_SPEED = 2.2; // 旧cardBreathe(1.8s周期)相当の角速度

// faceDownが true→false(伏せ→開示)になった瞬間だけ短い「めくり」演出を発火する。旧CSSのcardFlip
// (scaleX: 1→0.05→1)と同じ「潰れて戻る」動きをThree.jsのscale.xで再現する。
//
// 実際に踏んだ不具合: 当初は絵柄の切り替え(buildCardAppearanceに渡すfaceDown)を素直にpropの
// faceDownへ直結していたため、faceDownがtrueからfalseになった瞬間のReactレンダーで数字/特殊札の
// 絵柄が即座に描画され、そのカードがまだ正面(scaleX=1)を向いたまま数字が丸見えになる1フレーム以上の
// 間が生じていた（潰れ演出の開始自体はuseEffect経由で非同期に走るため、絵柄の切り替えより後追いに
// なる）。旧CSS版は「潰れ切ってから新しい絵柄が現れる」順序だったため気づかれなかった問題。
// 対応として、実際に描画する絵柄は独立したdisplayFaceDown stateで管理し、伏せ→表の遷移時は
// カードが潰れ切る中間地点(FLIP_DURATION_MS/2)を過ぎてから初めて絵柄を差し替える（潰れて見えない
// 瞬間に中身を入れ替える、という本来のトランプのめくり演出と同じ順序にする）。それ以外の遷移
// (表→伏せ等)は従来通りアニメーション無しで即座に切り替える。
function useCardFlipAnimation(faceDown, pending) {
  const groupRef = useRef(null);
  const prevFaceDown = useRef(faceDown);
  const flipStartRef = useRef(null);
  const [displayFaceDown, setDisplayFaceDown] = useState(faceDown);
  const swappedRef = useRef(true);

  useEffect(() => {
    if (prevFaceDown.current === true && faceDown === false) {
      flipStartRef.current = performance.now();
      swappedRef.current = false;
    } else if (prevFaceDown.current !== faceDown) {
      setDisplayFaceDown(faceDown);
      flipStartRef.current = null;
      swappedRef.current = true;
    }
    prevFaceDown.current = faceDown;
  }, [faceDown]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    let scaleX = 1;
    if (flipStartRef.current != null) {
      const elapsed = performance.now() - flipStartRef.current;
      if (elapsed < FLIP_DURATION_MS) {
        scaleX = Math.abs(Math.cos((elapsed / FLIP_DURATION_MS) * Math.PI));
        if (!swappedRef.current && elapsed >= FLIP_DURATION_MS / 2) {
          setDisplayFaceDown(false);
          swappedRef.current = true;
        }
      } else {
        // 実際に踏んだ不具合: 演出開始からこのフレームまでに既にFLIP_DURATION_MSを過ぎていると
        // （重いフレーム・タブのスロットリング・スクリーンショット等で1フレームが380msを超えると
        // 普通に起きる）、絵柄を差し替えないままflipStartRefだけを畳んでしまい、**開示済みのカードが
        // 永久に裏面のまま**残っていた。演出を飛ばすことはあっても、開示自体は必ず成立させる。
        if (!swappedRef.current) {
          setDisplayFaceDown(false);
          swappedRef.current = true;
        }
        flipStartRef.current = null;
      }
    } else if (pending && faceDown) {
      scaleX = 1 + Math.sin(clock.getElapsedTime() * BREATHE_SPEED) * 0.015;
    }
    groupRef.current.scale.x = scaleX;
  });

  return { groupRef, displayFaceDown };
}

// theme: 装備中のカードスキンID(CardArt.jsxのCARD_THEMESのキー)。呼び出し元が
// storage.jsのgetEquippedSkin()の値をそのまま渡す。未知のIDはclassicにフォールバックする。
export function Card3D({
  variant = "number", number, special, declaration, faceDown = false, pending = false,
  theme = "classic",
  position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, swing = false,
  ...groupProps // onClick/onPointerOver等(カード自体を操作対象にする画面で使う)
}) {
  const { groupRef: animRef, displayFaceDown } = useCardFlipAnimation(faceDown, pending);
  const palette = getCardPalette3D(theme);
  const { svg, materials } = useMemo(
    () => buildCardAppearance({ variant, number, special, declaration, faceDown: displayFaceDown, palette }),
    [variant, number, special, declaration, displayFaceDown, palette],
  );
  // SvgMesh3D自身は内部でSVG単位(最大寸法340程度)をworld空間4単位に正規化する自動スケールを持つため、
  // position/rotation/scaleはここで外側のgroupとして与える(SvgMesh3D側の自動スケールと二重に
  // 干渉させないため、SvgMesh3D自体にはposition/rotationを渡さずデフォルトのままにする)。
  return (
    <group position={position} rotation={rotation} scale={scale} {...groupProps}>
      <group ref={animRef}>
        <SvgMesh3D svg={svg} materialByColor={materials} depth={5} layerGap={1.3} bevelSize={0.7} swing={swing} />
      </group>
    </group>
  );
}
