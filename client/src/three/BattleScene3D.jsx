// 対戦画面(shared.jsxのBattleScreenChrome)の.kj-battle-field内に背景として敷く3Dシーン。
// 卓＋3行3列のグリッド（中央=場札2枚とKING/JOKER札 / 左=灯りとポット / 右=カードシューと席）を
// 1つのSceneCanvasにまとめる（「1画面1Canvas」——WebGLコンテキスト数の上限に触れないため）。
//
// 【3D主導】カード・目印・灯りの位置は three/layoutAnchors.js の座標が正で、DOM側
// (席の札など)が three/screenProjection.jsx の camera.project() でその座標に追従する。
// 逆向き（DOMを正として3Dが追いかける）だと、CSSに変更が入るたびに位置計算が引きずられて壊れる
// ——実際にそれで3件のバグを出したので、向きを反転させてある。
import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { SceneCanvas } from "./SceneCanvas.jsx";
import { Table3D } from "./Table3D.jsx";
import { Card3D } from "./Card3D.jsx";
import { SlotMarker } from "./SlotMarker.jsx";
import { getBattleLayoutConfig, computeBattleLayout } from "./layoutAnchors.js";
import { AnchorProjector, getAppShellZoom } from "./screenProjection.jsx";
import { getTablePalette3D } from "../TableArt.jsx";
import { getCardPalette3D } from "../CardArt.jsx";
import { PotLights3D } from "./Lights3D.jsx";
import { Dispenser3D, DispenseFx, useDispense } from "./Dispenser3D.jsx";
import { AppearGroup, CardRevealHand } from "./BattleFx3D.jsx";

// Card3Dはscale=1のとき幅2.82・高さ4(three/geometryCache.jsが最大寸法を4に正規化する)。
// 目印はそれより一回り大きい枠として同じ<group>の中に置くので、常にカードと寸分違わず一致する。
const SLOT_MARKER_WIDTH = 3.3;
const SLOT_MARKER_HEIGHT = 4.6;

// 場札1枚ぶん(目印+カード)。位置・スケールはlayoutAnchors.jsの座標をそのまま使う。
// marker(目印の色)は装備中の卓スキンから導出する——目印は卓に彫られた窪みという扱いなので、
// 卓だけ紫に変えて目印が緑のままだと同じ家具に見えなくなる。
function FieldSlot({ anchor, marker, children }) {
  return (
    <group position={anchor.position} scale={anchor.scale}>
      <SlotMarker width={SLOT_MARKER_WIDTH} height={SLOT_MARKER_HEIGHT} {...marker} />
      {children}
    </group>
  );
}


// SceneCanvasの内側(=<Canvas>の子)でしかuseThree()は呼べないため、シーンの中身は
// この内部コンポーネントに切り出してある。可視範囲(viewport)はcanvasのアスペクト比で変わるので、
// designViewportより狭い画面ではレイアウト全体を一律で縮めて卓が切れないようにする。
//
// self/opponent が持つ値: { cardValue, cardPlaced, cardPending, lives, totalLives, staked }。
// cardPlaced … その席が既に1枚出したか（伏せ札を置くかどうか）。cardValue … 開示された中身。
// **賭けている数は差分から導出せず、そのまま渡してもらう。** 旧実装はチップの移動量を
// 持ち点の増減から逆算していて、観測を1回でも落とすと以後ずっとずれていた（実際に踏んだ）。
function BattleSceneContents({ config, isDesktop, self, opponent, kjMode, cardTheme, tableTheme, onLayout, dealKey, potWinner = null }) {
  const { viewport, size } = useThree();
  // 卓の目印(SlotMarker)は卓スキンのトリム/フェルト色をそのまま使い、卓と同じ素材に見せる。
  const tablePalette = getTablePalette3D(tableTheme);
  const marker = useMemo(
    () => ({ accentColor: tablePalette.trim, feltColor: tablePalette.felt }),
    [tablePalette],
  );
  // 卓・カード・灯り・席の座標は、可視範囲とcanvasの実寸から毎回組み立てる
  // (固定座標の表では、canvasの縦横比・CSS zoom・操作ドックの高さといった実行時条件に
  //  追従できず、卓のはみ出しやパネルとの重なりが起きた。three/layoutAnchors.js参照)。
  const anchors = useMemo(() => computeBattleLayout(config, {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    canvasHeightPx: size.height,
    zoom: getAppShellZoom(),
    isDesktop,
  }), [config, isDesktop, viewport.width, viewport.height, size.height]);

  // 配札の演出。**キーは局番号**（局が変われば必ず両者に1枚ずつ補充される）。
  const deal = useDispense(dealKey);
  const columns = config.lives.columns;

  return (
    <>
      <Table3D theme={tableTheme} {...anchors.table} />
      <AnchorProjector anchors={anchors} onLayout={onLayout} />

      {/* 左の列にはポットだけを置く。**残ライフの灯りは卓に並べない**——
          手元に持っている、あるいは卓の外に置き場がある、という扱いにして、**賭けた分だけが
          フェルトに乗る**。卓の上に出ているものが常に「いま賭かっているもの」だけになるので、
          持ち物と賭け金を見分ける必要がなくなる。残ライフの数は進捗表(RoundScoreboard)が持つ。
          賭けた灯りは卓の外（selfStakeFrom / oppStakeFrom）から滑り込んでくる。 */}
      <PotLights3D anchor={anchors.pot} selfAnchor={anchors.selfStakeFrom} oppAnchor={anchors.oppStakeFrom}
        selfStaked={self?.staked ?? 0} oppStaked={opponent?.staked ?? 0} columns={columns}
        winner={potWinner} />

      {/* 右の列: カードシュー。山札は置かない（残り枚数を数えさせない設計のため）。 */}
      <Dispenser3D anchor={anchors.dispenser} />
      <DispenseFx deal={deal} anchors={anchors} cardTheme={cardTheme} />

      {/* 場札は**その席が実際に1枚出してから**置く（cardPlaced）。伏せ札は「もう出した」という
          強い意味を持つ札なので、宣言もカード選択もまだの段階から置いておくと、
          何も決めていないのに手が終わっているように見える。
          KJ札と同じ扱い——置かれるまでは卓に彫られた目印だけを残す。 */}
      <FieldSlot anchor={anchors.self} marker={marker}>
        <AppearGroup trigger={self?.cardPlaced}>
          {self?.cardPlaced && (
            <Card3D
              variant="number"
              theme={cardTheme}
              number={self?.cardValue?.number}
              special={self?.cardValue?.special}
              faceDown={!self?.cardValue}
              pending={self?.cardPending}
            />
          )}
        </AppearGroup>
        <CardRevealHand revealed={!!self?.cardValue} side="self" />
      </FieldSlot>

      <FieldSlot anchor={anchors.opp} marker={marker}>
        <AppearGroup trigger={opponent?.cardPlaced}>
          {opponent?.cardPlaced && (
            <Card3D
              variant="number"
              theme={cardTheme}
              number={opponent?.cardValue?.number}
              special={opponent?.cardValue?.special}
              faceDown={!opponent?.cardValue}
              pending={opponent?.cardPending}
            />
          )}
        </AppearGroup>
        <CardRevealHand revealed={!!opponent?.cardValue} side="opp" />
      </FieldSlot>

      {/* KING/JOKER札は局ごとに1枚だけ置かれる**共有の1枚**（自分/相手それぞれのものではない）。
          宣言が決まる前は目印だけを残して何も置かない。 */}
      <group position={anchors.kj.position} scale={anchors.kj.scale}>
        {/* KJ札の目印だけは卓のトリムではなくカードスキン側の最も明るい金属色で縁取り、
            「場に1枚だけ置かれる共有の札」であることを他のスロットと差別化して示す。 */}
        <SlotMarker
          width={SLOT_MARKER_WIDTH} height={SLOT_MARKER_HEIGHT}
          accentColor={getCardPalette3D(cardTheme).emblemColor} feltColor={tablePalette.felt}
        />
        {/* 確定した瞬間にフレーム単位で「出現」していたのを、横に潰れた状態から広がる動きにする。
            **Y軸で回してはいけない**——押し出しカードの裏面は本体色そのままの平板なので、
            途中で裏を向いた瞬間にのっぺりした色板が見える（実際にそうなった）。 */}
        <AppearGroup trigger={kjMode}>
          {kjMode && <Card3D variant="declaration" declaration={kjMode} theme={cardTheme} />}
        </AppearGroup>
      </group>
    </>
  );
}

// onLayout: three/screenProjection.jsxのAnchorProjectorが(実質的に変化があった時だけ)呼ぶ
// コールバック。shared.jsxのBattleScreenChromeがstateとして受け取り、卓の上に重ねるDOMの
// 絶対配置座標として使う。
// cardTheme/tableTheme: 装備中のスキンID。**3Dモジュール側からlocalStorageを直接読まないこと**
// ——装備を変えても再レンダーの契機が無く反映されないため、必ずpropとして受け取る。
export function BattleScene3D({ isDesktop, self, opponent, kjMode, cardTheme, tableTheme, onLayout, dealKey, potWinner = null }) {
  const config = getBattleLayoutConfig(isDesktop);
  return (
    // 正面補助光を右上へ逃がしてある。既定の[0,1,9](ほぼカメラ軸上)のままだと、鏡面反射がちょうど
    // カメラへ戻る一点——ワールドの(0, cameraZ/9)付近——にハイライトが集中する。3行3列グリッドでは
    // **カード3枚がまさにその中央線(x=0)に並ぶ**ので、相手の伏せ札が面ごと白く飛んで裏面の意匠が
    // 完全に消えていた（自分の山札や卓の隅のカードは正常なまま、中央の1枚だけが白いカードに見える）。
    // 光をX方向へずらすと反射の集中点はx≈cameraZ*6/9≒8.7、つまりフェルトの外へ出る。
    // 平らなカードに対する拡散光の入り方(N·L)は0.83倍程度しか落ちないので、イラスト札(QUEEN/
    // KING/JOKER)を正面から読ませるという本来の役目は保たれる。
    // 光を斜めへ逃がすと卓全体の拡散光も落ちるので、強さと環境光で取り戻す（環境の映り込みは
    // 一点に集中しないため、金の縁を明るく戻しても白飛びの原因にはならない）。
    <SceneCanvas cameraZ={config.cameraZ} frontFill={{ position: [6, 2, 9], intensity: 0.9 }} envIntensity={1.9}>
      <BattleSceneContents
        config={config}
        isDesktop={isDesktop}
        self={self}
        opponent={opponent}
        kjMode={kjMode}
        cardTheme={cardTheme}
        tableTheme={tableTheme}
        onLayout={onLayout}
        dealKey={dealKey}
        potWinner={potWinner}
      />
    </SceneCanvas>
  );
}
