// 対戦画面の3Dシーンのレイアウトを、実際に使える描画領域から毎回組み立てるモジュール。
//
// ── なぜ「固定ワールド座標の表」ではなく計算にしたのか ──
// 旧実装(three/domAnchors.jsxのAnchoredGroup)は逆に、カードの位置をDOM要素の
// getBoundingClientRect()から毎フレーム逆算していた。DOM側のCSSに変更が入るたび3D側が壊れる
// 構造だったため、いったん「全部を固定ワールド座標にする」方向へ反転させた。
// ところが固定座標では、canvasの縦横比・CSS zoom・操作ドックの高さといった実行時にしか
// 分からない条件に対応できず、画面サイズによって卓が画面外にはみ出したり、名前パネルや
// 操作ドックが卓に重なったりした。
// そこで現在は「レイアウトの意図(卓に対する相対配置)」だけをここに定数として持ち、
// 実際のワールド座標はcomputeBattleLayout()が実行時の可視範囲から算出する。
// DOM側は引き続き3Dが算出した座標に従う(three/screenProjection.jsx)ので、
// 「3Dが正・DOMが従う」という向き自体は変わっていない。
//
// ── 座標系の性質 ──
// ・可視範囲の高さはcameraZとfov(45°)だけで決まり画面幅に依存しない: 2*cameraZ*tan(22.5°)。
// ・幅だけがcanvasの縦横比で変わる。
// ・卓はz=-2.2に置いてカードと奥行きを分けているので、画面上の見かけの大きさは
//   cameraZ/(cameraZ+2.2)倍になる(perspective係数)。カードはz=0なので等倍。
// ・カード(240×340)・卓のSVGは、three/geometryCache.jsが最大寸法を4ワールド単位に
//   正規化する。scale=1のカードは高さ4・幅4*(240/340)=2.82。

import { TABLE_SVG } from "./tableSvgBuilders.js";

// index.cssの .kj-action-dock / .kj-battle-field と必ず一致させること(CSS側にも注記あり)。
// 卓が下へ伸びてよい限界を決めるのに使う。
const DOCK_HEIGHT_PX = { landscape: 112, portrait: 124 };
const FIELD_PADDING_PX = 12;

const TABLE_Z = -2.2;

// ── 盤面の構成（手書きの配置図からの作り直し）──
// 卓を**3行×3列のグリッド**として使う。中央の列だけがカードで、左右の列は各自の持ち物。
//
//   奥(相手)   : 相手の持ちチップ ─ 相手の場札 ─ 相手の山札
//   中央        : 相手の賭けチップ ─ [ KING/JOKER札 ] ─ 自分の賭けチップ
//   手前(自分) : 自分の山札       ─ 自分の場札 ─ 自分の持ちチップ
//
// 点対称に置く（自分の持ちチップは手前の右、相手の持ちチップは奥の左）。向かい合って座った
// 2人がそれぞれ自分の右手側に持ちチップを積み、山札を左手側に置いている、という座り方。
// 賭けチップは各自の持ちチップの真隣（自分＝右の中段、相手＝左の中段）に出るので、
// 「手元の山から前へ押し出した」動きがそのまま読める。
//
// ── 大きさを決めた制約（ここが今回いちばん変わった）──
// 旧構成は中央帯にカード3枚を**横一列**に並べていたので、縦は1枚ぶんで足りていた。
// 3行になったことで縦にカード3枚が要り、**カードの大きさは卓の縦幅を3で割った値で頭打ち**になる。
// 卓の縦幅は操作ドックと名前パネルに挟まれた帯で決まり、table.scaleを上げてもfitが下がって
// 相殺されるだけなので増やせない——つまりカードを大きくする方法は「帯を広げる」しかない。
// そこで名前パネルから手札ストリップ(MyHandStrip)を抜いて右の補助列へ移し、
// パネルの実高さを約142px→62pxまで削った。これが今回いちばん効いていて、帯が4割ほど広がった
// おかげでカードは旧構成の7割強の大きさに収まっている（この移動が無いと半分以下になる）。
//
// ── 数値の決め方 ──
// 以下の座標は「卓の中心を原点とし、fit=1(卓が縮められていない状態)を基準にした相対値」。
// 縦の予算: 2*rowPitch + 4.6*cardScale ≦ フェルト面の縦幅 (4.6=SlotMarkerの高さ)。
// 横の予算: colDx + (目印またはチップの半幅) ≦ フェルト面の半幅。
// **卓の寸法はフェルト面で測ること**。卓全体の幅で計算すると木の縁の上に物が乗る（実際に踏んだ）。
const LAYOUTS = {
  landscape: {
    cameraZ: 13,
    tableVariant: "landscape",
    // 卓の見かけ幅の設計値。実際の可視幅がこれより狭ければ全体を縮める。卓の実幅(11.12)より
    // わずかに大きくしてあるのは、幅で頭打ちになる画面(1920幅など)で卓が盤面の縁に接触しないよう
    // 数%の余白を残すため。
    designWidth: 11.5,
    table: { scale: 3.25, tiltX: 0 },
    // **横長は席の現況(SeatStatus)を卓の"脇"へ出すので、上下に空ける厚みは0。**
    // 横長の卓は縦で頭打ちになり横が大きく余る（画面が横に広いほど余る）ので、
    // 上下に置くと卓が縦に痩せるだけ——同じ物を横の余りへ逃がせば卓は1pxも縮まない。
    // 縦の対応（相手が上・自分が下）は、脇に置いても**場札の行の高さに合わせる**ことで保たれる。
    panel: { heightPx: 0, gapPx: 0, selfSide: "bottom", side: true },
    // 場札・KJ札で**共通**のスケール（3枚とも同じ大きさ）。別々の値を持たせないこと。
    cardScale: 0.39,
    // 行間(中央行→上下行)。4.6*cardScale=1.79 が目印の高さなので、これより大きくすること
    // （下回ると上下の行の目印が重なり、3行が地続きの帯に見える）。
    rowPitch: 1.96,
    // 左右の列のx。フェルト面の半幅(5.03)を3等分した位置に置くと、手書き配置図と同じ
    // 「均等な3列」になる。
    colDx: 3.35,
    // 灯り(ライフ)とポット。列の幅いっぱいに広がらないよう、目印1つぶんの高さに収まる粒で組む。
    lives: { scale: 1, columns: 4 },
    // カードシュー(配札の機械)。卓の右端で、行としては中央。
    dispenser: { scale: 1 },
  },
  portrait: {
    cameraZ: 15,
    tableVariant: "portrait",
    // 縦長は常に幅で頭打ちになる（可視範囲の高さはcameraZで固定、幅だけがcanvasの縦横比で動く
    // ——盤面が縦に短くなるほどワールドの幅は広がる）。席の札が卓の外から消えて盤面が縦に
    // 縮んだぶん幅に余裕が出たので、卓の設計寸法をそこまで広げる。卓の実幅(7.50)＋わずかな余白。
    designWidth: 7.8,
    table: { scale: 2.15, tiltX: 0 },
    // 縦長は逆に「横が足りず縦が余る」ので、席の現況は卓の上下へ置く（脇に出す幅が無い）。
    // **DOMの実測値に合わせること**——小さいとパネルが卓に食い込む（以前この値の更新漏れで踏んだ）。
    panel: { heightPx: 30, gapPx: 10, selfSide: "bottom", side: false },
    cardScale: 0.33,
    rowPitch: 1.66,
    colDx: 2.1,
    lives: { scale: 0.78, columns: 4 },
    dispenser: { scale: 0.8 },
    panelDx: 0,
  },
};

export function getBattleLayoutConfig(isDesktop) {
  return isDesktop ? LAYOUTS.landscape : LAYOUTS.portrait;
}

// 実行時の描画条件から、卓・カード・チップ・山札・名前パネルの具体的なワールド座標を組み立てる。
//   viewportWidth / viewportHeight : 可視範囲(ワールド単位、useThree().viewport)
//   canvasHeightPx                 : canvasの実ピクセル高さ(useThree().size.height、CSS zoom込み)
//   zoom                           : .kj-app-shell の実効CSS zoom
export function computeBattleLayout(config, { viewportWidth, viewportHeight, canvasHeightPx, zoom, isDesktop }) {
  const svg = TABLE_SVG[config.tableVariant];
  const persp = config.cameraZ / (config.cameraZ - TABLE_Z);
  const tableHalfW0 = ((4 * config.table.scale) / 2) * persp;
  const tableHalfH0 = ((4 * (svg.height / svg.width) * config.table.scale) / 2) * persp;

  // 1ワールド単位が何CSSピクセルか(canvasの高さは可変なので実行時にしか分からない)。
  const worldPerCssPx = canvasHeightPx > 0 ? (viewportHeight * zoom) / canvasHeightPx : 0;
  const dockPx = DOCK_HEIGHT_PX[isDesktop ? "landscape" : "portrait"];

  // 卓を置いてよい縦の帯。上端は可視範囲の上端、下端は操作ドック(DOM)の上端。
  const bandTop = viewportHeight / 2;
  const bandBottom = -viewportHeight / 2 + (dockPx + FIELD_PADDING_PX) * worldPerCssPx;

  // 名前パネルが卓の上/下に確保しなければならない厚み(卓の縁からパネルの外側まで)。
  // **席の札は進捗表(ヘッダー直下の帯)へ移ったので、卓の周りに空ける必要はもう無い。**
  // heightPx を 0 にすると卓がその厚みぶん大きくなる——空けたままにすると、誰も使わない
  // 余白のために卓を縮め続けることになる。
  const panelReserve = (config.panel.heightPx + config.panel.gapPx) * worldPerCssPx;
  const reserveTop = panelReserve;
  const reserveBottom = config.panel.selfSide === "bottom" ? panelReserve : 0;

  // 幅・高さの両方に収まる倍率を選ぶ(どちらかが必ず制約になる)。
  const usableTop = bandTop - reserveTop;
  const usableBottom = bandBottom + reserveBottom;
  const widthFit = viewportWidth / config.designWidth;
  const heightFit = tableHalfH0 > 0 ? (usableTop - usableBottom) / (2 * tableHalfH0) : 1;
  const fit = Math.max(0.25, Math.min(1, widthFit, heightFit));

  const tableHalfH = tableHalfH0 * fit;
  const tableHalfW = tableHalfW0 * fit;
  const tableCenterY = (usableTop + usableBottom) / 2; // 帯の中央に卓を置く

  // 3行3列のグリッド。中央行が卓の中心、上下の行がrowPitchぶん離れる。
  const cardScale = config.cardScale * fit; // 場札とKJ札で必ず同じ値を使う
  const dx = config.colDx * fit;
  const midY = tableCenterY;
  const oppY = tableCenterY + config.rowPitch * fit;
  const selfY = tableCenterY - config.rowPitch * fit;
  const livesScale = config.lives.scale * fit;

  const panelOuter = (config.panel.heightPx / 2 + config.panel.gapPx) * worldPerCssPx;
  const panelTopY = tableCenterY + tableHalfH + panelOuter;
  const panelBottomY = tableCenterY - tableHalfH - panelOuter;
  const selfPanelY = config.panel.selfSide === "bottom" ? panelBottomY : panelTopY;
  // 横長は2枚のパネルが同じ高さに並ぶので、卓の列に合わせて寄せるだけだと狭い画面で左右のパネルが
  // 接触する。パネルの実幅(200px)＋隙間を下限として確保する。
  // 相手を上・自分を下に置くので、2枚が同じ高さに並ぶことはない
  // ——横方向の最小距離(旧panelDxMin)は要らなくなった。
  const panelDx = (config.panelDx ?? config.colDx) * fit;
  // 脇に置くときのx。卓の縁からパネルの半幅ぶん外へ出す（DOMの実測値に合わせること）。
  const SIDE_PANEL_HALF_WIDTH_PX = 84;
  const sideDx = tableHalfW + (SIDE_PANEL_HALF_WIDTH_PX + 14) * worldPerCssPx;

  return {
    fit,
    tableHalfW,
    tableHalfH,
    // 卓のpositionは「見かけの位置」ではなく実座標なので、perspective係数で割り戻す。
    table: {
      variant: config.tableVariant,
      scale: config.table.scale * fit,
      tiltX: config.table.tiltX,
      position: [0, tableCenterY / persp, TABLE_Z],
    },
    // 中央の列: 相手の場札(奥) / KING・JOKER札(中央) / 自分の場札(手前)。3枚とも同じ大きさ。
    opp: { position: [0, oppY, 0], scale: cardScale },
    kj: { position: [0, midY, 0], scale: cardScale },
    self: { position: [0, selfY, 0], scale: cardScale },
    // **左の列にはポットだけを置く。** 残ライフの灯りは卓に並べない——
    // 手元に持っている／卓の外に置き場がある、という扱いにして、**賭けた分だけがフェルトに乗る**。
    // 卓の上にある物が常に「いま賭かっている物」だけになるので、持ち物と賭け金を見分けずに済む。
    // 残ライフの数は進捗表(battle/components.jsx の RoundScoreboard)が持つ。
    pot: { position: [-dx, midY, 0], scale: livesScale },
    // 賭けた灯りの**出発点**。卓の縁の外に置くことで「卓の外の置き場から出してきた」動きになる
    // （灯りそのものはここに描かれない。PotLights3D が滑りの起点として使うだけ）。
    oppStakeFrom: { position: [-dx, tableCenterY + tableHalfH + 0.6, 0], scale: livesScale },
    selfStakeFrom: { position: [-dx, tableCenterY - tableHalfH - 0.6, 0], scale: livesScale },
    // **右の列は「席」と機械。** 中央にカードシュー(配札の機械)、その上下が各自の席
    // （モバイルでは名前とUP/DOWNの公表をここへ重ねる。デスクトップは補助列に出す）。
    dispenser: { position: [dx, midY, 0], scale: config.dispenser.scale * fit },
    oppSeat: { position: [dx, oppY, 0], scale: livesScale },
    selfSeat: { position: [dx, selfY, 0], scale: livesScale },
    // 席の現況(SeatStatus)を置く点。**卓の外**であることは共通で、置き方だけが向きで変わる:
    //   横長 … 卓の左脇、場札の行と同じ高さ（縦を使わない）
    //   縦長 … 卓の上下、中央揃え（横を使わない）
    // どちらでも「相手が奥・自分が手前」という場札と同じ上下関係になるので、名前を書かなくて済む。
    selfPanel: { position: config.panel.side ? [-sideDx, selfY, 0] : [-panelDx, selfPanelY, 0] },
    oppPanel: { position: config.panel.side ? [-sideDx, oppY, 0] : [panelDx, panelTopY, 0] },
  };
}
