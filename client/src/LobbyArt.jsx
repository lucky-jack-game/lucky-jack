// ホームのロビー（高級カジノホテルの大ホール）の絵。CardArt.jsx / TableArt.jsx と同じく、
// イラストでも画像でもなく、幾何・光・CSSグラデーションだけで組む（イラスト制作パイプラインは無い）。
// 見た目の定義は lobby.css、部品の並びと入場の演出の時刻は LobbyScreen.jsx。
//
// 奥から手前へ:
//   ホール（格天井・コーニス・遠くの灯りのボケ・シャンデリア・大理石の床）
//   → 回廊（壁龕と同じ形のアーチを手前へ大きく重ねた一点透視と、その燭台）
//   → 展示の壁龕 → ペンダント灯とスポット → 主卓
//
// **主卓は対戦で使う卓そのもの。** WebGLが使える端末では3D（three/Showcase3D.jsx の LobbyTable3D ＝
// Table3D / Card3D そのもの）、使えない端末・3Dの読み込みに失敗した時は同じ卓の2D版（下の LobbyTable2D。
// 3Dが押し出しているのと同じSVGを斜めに寝かせた物）を出す。ホームは最初の画面なので、
// **3Dが失敗しても画面ごと落ちないこと**が要件——R3F の Canvas は生成に失敗すると throw するので、
// 必ずエラー境界の内側に置く。
import { Component, Fragment, lazy, Suspense, useMemo } from "react";
import { PlayingCard } from "./CardArt.jsx";
import { getTablePalette3D } from "./TableArt.jsx";
// tableSvgBuilders.js は three.js を import しない（TableArt.jsx だけ）ので、ここから読んでも
// 3Dのチャンクをメインバンドルへ引き込まない——**あのファイルに three を持ち込まないこと。**
import { buildTableSvg } from "./three/tableSvgBuilders.js";

// three.js 一式（gzip 約260KB）を連れてくるので必ず lazy。タイトル画面の間に prefetchLobby3D() で
// 先読みしておき、ロビーに入った時点では読み終わっている状態にする。
const LobbyTable3D = lazy(() => import("./three/Showcase3D.jsx").then((m) => ({ default: m.LobbyTable3D })));

// 最遠景の写真（任意）。**まだ無い**——ホールはCSSだけで描いてある。画像を用意したら
// client/public/lobby/ に置いてパスを入れる（原本は client/art-src/ へ。人物・文字・実在の施設と
// 分かる造形を入れないこと）。入れても下のCSSの層は上に重ねたまま使う。
// 例: { wide: "/lobby/hall-wide.webp", tall: "/lobby/hall-tall.webp" }
const LOBBY_BACKDROP = null;

// ─── 3Dを出してよい端末か ───
// **WebGL のコンテキストが作れるかだけを見る。** 以前は failIfMajorPerformanceCaveat と描画装置の名前
// （SwiftShader などのソフトウェア描画）でも弾いていたが、ホームだけがその判定を持っていて、
// **スマホでは3DのQueenが出るのにPCではホームの卓だけ2Dになっていた**。
// 対戦画面とショップの3Dはこの判定を通らずに描いているので、
// ホームだけ厳しくしても端末の負荷は下がらず、画面によって見た目が割れるだけだった。
// 2Dへ落とすのは、WebGL 自体が無い端末と、作れても描画に失敗した時（下のエラー境界）だけ。
// 調べるために作ったコンテキストはすぐ手放す——ブラウザのWebGLコンテキスト数には上限がある。
let lobby3DCapable = null;
export function canUseLobby3D() {
  if (lobby3DCapable != null) return lobby3DCapable;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    lobby3DCapable = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    lobby3DCapable = false;
  }
  return lobby3DCapable;
}
export function prefetchLobby3D() {
  if (canUseLobby3D()) import("./three/Showcase3D.jsx").catch(() => {});
}

// 3Dの生成・読み込みが失敗したら2Dの卓へ落とす。
class Lobby3DBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

// 卓に置く物。**相手の札は伏せ、自分の札は表**——自分の札は常に見え、相手の札だけが隠れている、
// というこのゲームの情報の形そのもの。表にするのは看板の札（Queen。内部識別子は "king"）。
// 位置と大きさは3D版（Showcase3D.jsx の LOBBY_SEAT_Y / LOBBY_CARD_SCALE）と揃えてある。
const SEATS = [
  { key: "far", top: "27%", card: { faceDown: true } },
  { key: "near", top: "73%", card: { variant: "number", number: 10, special: "king" } },
];

function LobbyTable2D({ tableTheme, cardTheme }) {
  const palette = getTablePalette3D(tableTheme);
  const src = useMemo(
    () => `data:image/svg+xml;utf8,${encodeURIComponent(buildTableSvg(palette, "landscape").svg)}`,
    [palette],
  );
  return (
    <div className="kj-lobby-table">
      <div className="kj-lobby-table-shadow" />
      <div className="kj-lobby-table-plane">
        <img src={src} alt="" draggable={false} />
        {/* 天板の厚み。3Dの卓の押し出しの側面に当たる。上端に金の線を引くと、黒いレールが背景に
            溶けて線だけが卓から浮いて見えた——上端は淡い照り返しにし、レールの色から暗部へ落とす。 */}
        <div className="kj-lobby-table-edge"
          style={{ background: `linear-gradient(180deg, rgba(244,231,191,0.2) 0 1px, ${palette.rail} 1px, #030201 100%)` }} />
        {SEATS.map((s) => (
          <div key={s.key} className="kj-lobby-seat"
            style={{ top: s.top, border: `1px solid ${palette.trim}99` }}>
            <PlayingCard {...s.card} width={60} theme={cardTheme} />
          </div>
        ))}
      </div>
    </div>
  );
}

// 壁龕の中の光に舞う塵。x＝横位置(%)、d＝周期(s)、o＝位相(s)、dx＝漂う横幅(px)。
const MOTES = [
  { x: 38, d: 7, o: 0, dx: 6 },
  { x: 46, d: 9, o: 2.5, dx: -5 },
  { x: 54, d: 8, o: 1.2, dx: 4 },
  { x: 61, d: 10, o: 4, dx: -6 },
  { x: 49, d: 6.5, o: 5.5, dx: 3 },
  { x: 42, d: 8.5, o: 3.3, dx: -3 },
];

// 展示の壁龕＝**部屋の奥の面そのもの**。床・天井・左右の壁・柱はこの矩形から引く（LobbyHall）。
// 主卓を「展示台に据えられ、スポットライトを浴びた一品」として納める構図は変えていない。
// 3Dの卓は固定カメラの透明Canvasなので部屋（CSS）の遠近とは厳密には一致しない——一致させようと
// せず、奥の面に嵌まった展示物という構図でその食い違いを吸収する。
//
// **手前へ重ねる回廊のアーチ（ENFILADE）は外した。** 部屋を箱として組んだ後は、あれだけが
// 別の消失点を持つ2つ目の奥行き装置になり、壁と噛み合わずに浮く。奥行きの装置は1つにする。
export function LobbyStage({ tableTheme, cardTheme, introPhase = "done", revealMs }) {
  const flat = <LobbyTable2D tableTheme={tableTheme} cardTheme={cardTheme} />;
  return (
    <div className="kj-lobby-stagewrap">
      <div className="kj-lobby-alcove kj-arch kj-gilt">
        <div className="kj-lobby-pendant" />
        <div className="kj-lobby-spot" />
        <div className="kj-lobby-motes" aria-hidden="true">
          {MOTES.map((m, i) => (
            <i key={i} style={{ left: `${m.x}%`, "--d": `${m.d}s`, "--o": `${-m.o}s`, "--dx": `${m.dx}px` }} />
          ))}
        </div>
        <div className="kj-lobby-dais" />
        {canUseLobby3D() ? (
          <Lobby3DBoundary fallback={flat}>
            <Suspense fallback={flat}>
              <div className="kj-lobby-table3d">
                <LobbyTable3D theme={tableTheme} cardTheme={cardTheme} introPhase={introPhase} revealMs={revealMs} />
              </div>
            </Suspense>
          </Lobby3DBoundary>
        ) : flat}
        {/* 入場の演出で金の縁を走る光。演出の外では出さない（lobby.css の lobbyTrace） */}
        <div className="kj-lobby-trace" aria-hidden="true" />
      </div>
    </div>
  );
}

// 遠くの灯りのボケ。x/y＝位置(%)、r＝径(px)、d＝周期(s)、o＝位相(s)。
const BOKEH = [
  { x: 8, y: 14, r: 26, d: 7, o: 1 }, { x: 18, y: 30, r: 14, d: 5.5, o: 3 },
  { x: 27, y: 9, r: 18, d: 8, o: 2 }, { x: 36, y: 24, r: 10, d: 6, o: 4 },
  { x: 44, y: 6, r: 12, d: 7.5, o: 0.5 }, { x: 57, y: 8, r: 14, d: 6.5, o: 2.5 },
  { x: 64, y: 26, r: 10, d: 5, o: 1.5 }, { x: 73, y: 10, r: 20, d: 8.5, o: 3.5 },
  { x: 83, y: 28, r: 14, d: 6, o: 0 }, { x: 92, y: 15, r: 24, d: 7, o: 2 },
  { x: 12, y: 50, r: 9, d: 5, o: 1 }, { x: 88, y: 52, r: 9, d: 5.5, o: 2.2 },
];

function LobbyBackdrop() {
  if (!LOBBY_BACKDROP) return null;
  return (
    <picture className="kj-lobby-backdrop">
      <source media="(min-width: 768px)" srcSet={LOBBY_BACKDROP.wide} />
      <img src={LOBBY_BACKDROP.tall} alt="" decoding="async" />
    </picture>
  );
}

// ─── 部屋はひとつの箱として組む ───────────────────────────────────
// **奥の面＝展示の壁龕**。天井・床・左右の壁は、その四隅と画面の四隅を結んだ面（一点透視）。
// こう組むと辺が必ず接ぐので、部品を並べた絵ではなく閉じた部屋になる。消失点も地平線も1つ。
//
// **以前は部品ごとに別々の遠近を持っていた**（天井 perspective(420px) / 床 520px / 回廊はただの
// 拡大 / 壁龕は遠近なしの角丸長方形 / 卓は three.js の本物のカメラ）。消失点を共有していない絵は、
// 1枚1枚は正しく見えても並べた瞬間に「それっぽい物の寄せ集め」になる。
// **新しい部品をここへ足すときも、必ず room から座標を引くこと。**
//
// room = 壁龕の矩形（ホールに対する%。LobbyScreen.jsx が実測して渡す）。測り終わるまでは
// 箱を描かない——当て推量の初期値を置くと、測った瞬間に部屋が跳ねる。
const poly = (pts) => `polygon(${pts.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(", ")})`;
const lerp = (a, b, t) => a + (b - a) * t;

// 壁に並ぶ柱。置く場所は**距離**で指定する（DEPTHS。0＝奥の壁、1＝カメラの位置）。距離を等間隔に
// 取れば、画面上の間隔は k が勝手に詰めてくれる——**画面上の位置を等間隔に置かないこと**（奥ほど
// 詰まって見えるのが遠近そのもので、等分に置くと並べた串に見える）。
// **1本を長方形で描かないこと。** 柱は壁の上に立っているので、上辺も下辺も消失点へ向かって傾く。
// 奥と手前の2つの距離（u と u+COL_DEPTH）で四隅を取れば、その台形がそのまま正しい姿になる
// ——長方形の棒を並べた版は、列としては奥へ向かうのに1本1本が平行なままで、板を貼ったように見えた。
// 手前側は kMax（画面から出る所）で止める。
// ─── 部屋の幾何：一点透視は「消失点からの相似拡大」ただ1つで作る ───────────────
// 奥の面（壁龕）の点を消失点 vp を中心に k 倍した点が、その点を k 倍だけ手前に持って来た位置になる。
// 天井・床・壁・柱・目地を**全部この操作から**出すので、面ごとに角度が食い違うことが原理的に
// 起きない。垂直な辺が画面でも垂直に保たれるのも自動（上下の隅が同じ k で動くため）。
// k=1 が奥の面、k が大きいほど手前。画面の外へ出る k（kExit）までが見えている範囲。
//
// **画面の四隅と奥の四隅を直線で結ぶのは間違い。** 最初の版がこれで、その4本は1点では交わらない
// ——奥の矩形が画面の矩形の相似形でない限り交わりようがなく、天井・壁・床がそれぞれ別の消失点を
// 持つ絵になる。**ここを直線で結び直さないこと。**
const EYE = 0.6;                  // 消失点の高さ（壁龕の上辺→下辺のどこに目線を置くか＝卓の天板あたり）
// 柱を置く距離（0＝奥の壁、1＝カメラの位置。各壁で見えている範囲に対する割合）。
// **手前の端まで届かせること。** 奥半分にしか並べない版は、横に広い画面ほど手前が大きな空き面に
// なり、壁がそこで途切れて見えた。
const DEPTHS = [0.14, 0.34, 0.56, 0.8];
const COL_DEPTH = 0.075;          // 柱1本ぶんの厚み（同じ単位）
const ROW_STEP = 0.085;           // 床・天井の石の目地の間隔（同じ単位。等間隔の石が遠近で詰まる）
const kOf = (u) => 1 / Math.max(0.05, 1 - u);

function roomGeom(room) {
  const vp = { x: (room.x0 + room.x1) / 2, y: lerp(room.y0, room.y1, EYE) };
  const corner = {
    tl: [room.x0, room.y0], tr: [room.x1, room.y0],
    br: [room.x1, room.y1], bl: [room.x0, room.y1],
  };
  const at = (c, k) => [vp.x + (corner[c][0] - vp.x) * k, vp.y + (corner[c][1] - vp.y) * k];
  // その隅を通る線が画面から出るときの k。
  const kExit = (c) => {
    const dx = corner[c][0] - vp.x, dy = corner[c][1] - vp.y;
    let k = Infinity;
    if (dx > 1e-6) k = Math.min(k, (100 - vp.x) / dx);
    if (dx < -1e-6) k = Math.min(k, -vp.x / dx);
    if (dy > 1e-6) k = Math.min(k, (100 - vp.y) / dy);
    if (dy < -1e-6) k = Math.min(k, -vp.y / dy);
    return k;
  };
  return { room, vp, at, kExit };
}

// 画面の枠を時計回りに辿るときの位置（上辺 0〜1 / 右辺 1〜2 / 下辺 2〜3 / 左辺 3〜4）。
const SCREEN_CORNERS = [[0, 0, 0], [100, 0, 1], [100, 100, 2], [0, 100, 3]];
const borderParam = ([x, y]) => (
  y <= 0.02 ? x / 100
    : x >= 99.98 ? 1 + y / 100
      : y >= 99.98 ? 2 + (100 - x) / 100
        : 3 + (100 - y) / 100);
function borderPath(a, b) {
  const pa = borderParam(a);
  let span = borderParam(b) - pa;
  if (span < 0) span += 4;
  return SCREEN_CORNERS
    .map(([x, y, p]) => ({ x, y, d: ((p - pa) % 4 + 4) % 4 }))
    .filter((c) => c.d > 1e-6 && c.d < span - 1e-6)
    .sort((m, n) => m.d - n.d)
    .map((c) => [c.x, c.y]);
}
// 面ひとつ：奥の辺の2隅 → それぞれの線が画面から出る点 → その間にある画面の隅、で閉じる。
function face(g, a, b) {
  const ea = g.at(a, g.kExit(a)), eb = g.at(b, g.kExit(b));
  return [g.at(a, 1), ea, ...borderPath(ea, eb), eb, g.at(b, 1)];
}

// 壁に貼る1枚。四隅（ホールに対する%）から、外接する箱と箱に対する clip-path を作る。
// 箱で持つのは、模様を**その1枚の幅に対する割合**で刻めるようにするため（奥の細い柱では
// 溝も一緒に詰まる＝模様そのものが遠近を持つ）。
function wallPiece(pts, extra) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const bx = Math.min(...xs), by = Math.min(...ys);
  const bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
  if (!(bw > 0.01 && bh > 0.01)) return null;
  return {
    left: `${bx}%`, top: `${by}%`, width: `${bw}%`, height: `${bh}%`,
    clipPath: poly(pts.map(([x, y]) => [((x - bx) / bw) * 100, ((y - by) / bh) * 100])),
    ...extra,
  };
}

// 壁の上下の隅（柱・ベイ・コーブはすべてこの2本の線の間に立つ）。
const wallEdges = (side) => (side === "left" ? ["tl", "bl"] : ["tr", "br"]);

function Colonnade({ g, side }) {
  const [top, bot] = wallEdges(side);
  const kMax = wallKMax(g, side);
  // **距離の刻みは壁ごとの「見えている範囲」に対する割合で取る。** 固定の距離で置くと、
  // 消失点から正しく引いた壁は画面上で短いので、2本目から先が範囲外に落ちて柱が消える
  // （実際に1本しか出なくなった）。範囲に対する割合なら、どの画面でも同じ本数が並ぶ。
  const uMax = 1 - 1 / kMax;
  return DEPTHS.map((f, i) => {
    const u = uMax * f;
    const k1 = Math.min(kOf(u), kMax);
    const k2 = Math.min(kOf(u + uMax * COL_DEPTH), kMax);
    const style = k2 > k1 + 1e-3 ? wallPiece(
      [g.at(top, k1), g.at(top, k2), g.at(bot, k2), g.at(bot, k1)],
      // 手前ほど暗く沈める（空気遠近）。奥は霞んで壁に溶ける。
      { "--depth": Math.min(1, u / 0.6).toFixed(2) },
    ) : null;
    return style ? <i key={i} className="kj-lobby-col" style={style} /> : null;
  });
}

// 柱と柱の間の壁面。**黒い隙間にしないこと**——間が黒いと、柱が壁ではなく穴の前に立って見える
// 。この種の内装は柱間に必ず面があり、下から間接照明が当たっている。
function WallBays({ g, side }) {
  const [top, bot] = wallEdges(side);
  const kMax = wallKMax(g, side);
  // 壁を奥から手前へ「ベイ・柱・ベイ・柱…」と刻む。**柱と同じ割合の刻みを使うこと**
  // ——別々に決めると柱とベイがずれ、柱の上にベイが乗る。
  const uMax = 1 - 1 / kMax;
  const edges = [0];
  DEPTHS.forEach((f) => edges.push(uMax * f, uMax * (f + COL_DEPTH)));
  edges.push(uMax);
  const bays = [];
  for (let i = 0; i + 1 < edges.length; i += 2) bays.push([edges[i], edges[i + 1]]);
  return bays.flatMap(([a, b], i) => {
    const k1 = Math.min(kOf(a), kMax);
    const k2 = Math.min(kOf(b), kMax);
    if (!(k2 > k1 + 1e-3)) return [];
    const depth = { "--depth": Math.min(1, a / 0.6).toFixed(2) };
    // 名前を face にしないこと（モジュールの face() を隠す。この関数が呼んでいないので今は
    // 動くが、次にここで面を作ろうとした人が黙って別物を掴む）。
    const faceStyle = wallPiece([g.at(top, k1), g.at(top, k2), g.at(bot, k2), g.at(bot, k1)], depth);
    // 落とし込みのパネル。壁の面をそのまま平らに残さず、一回り内側に窪んだ面を作る
    // ——この分節があるかどうかが、廊下と「高級ホテルの廊下」の差になる。
    const inset = (b - a) * 0.16;
    const p1 = Math.min(kOf(a + inset), kMax);
    const p2 = Math.min(kOf(b - inset), kMax);
    const panel = p2 > p1 + 1e-3 ? wallPiece([
      atWall(g, side, p1, 0.24), atWall(g, side, p2, 0.24),
      atWall(g, side, p2, 0.8), atWall(g, side, p1, 0.8),
    ], depth) : null;
    return [
      faceStyle ? <i key={`b${i}`} className="kj-lobby-bay" style={faceStyle} /> : null,
      panel ? <i key={`p${i}`} className="kj-lobby-bayframe" style={panel} /> : null,
    ].filter(Boolean);
  });
}

// 壁と床の境に通す間接照明（幅木のコーブ）。**境を線で締めないこと。**
// 床が柱に沿って切れて見えていたのは、壁と床が値だけで隣り合っていて継ぎ目に何も無かったから
// 。光の帯を1本置くと、同じ継ぎ目が「光っている縁」として読める。
// 壁の上の点。k＝奥行き、h＝高さ（0＝床、1＝天井）。**垂直な辺は画面でも垂直**なので x は上下で
// 共通——だから高さは y を比で取るだけでよい。壁に付く物は全部これで置く。
function atWall(g, side, k, h) {
  const [top, bot] = wallEdges(side);
  const p = g.at(bot, k), q = g.at(top, k);
  return [p[0], p[1] + (q[1] - p[1]) * h];
}
// 壁の造作をどこまで伸ばすか。**min を取らないこと。** 上の隅を通る線が画面から出る k と
// 下の隅のそれは別で、min にすると早く出た方に合わせて帯・柱・灯りが手前で止まる——壁の面だけが
// 画面の端まで続き、内装がその手前で切れて見える。
// はみ出した分は層の overflow が切るので、遠い方の隅まで伸ばしてよい。上限は安全弁
// （線が画面の辺とほぼ平行だと k が際限なく大きくなる）。
const wallKMax = (g, side) => {
  const [top, bot] = wallEdges(side);
  return Math.min(Math.max(g.kExit(top), g.kExit(bot)), 14);
};

// 壁を奥から手前へ走る水平の帯（幅木・腰壁の見切り・軒・天井際のコーブ）。
// **高さを比で指定するので、奥では自動的に細くなる**——px で置くと奥だけ太い帯になる。
// 壁面の分節が無い部屋は、箱として正しくても「内装の入っていない箱」に見える。
function WallBand({ g, side, from, to, className }) {
  const kMax = wallKMax(g, side);
  const style = wallPiece([
    atWall(g, side, 1, from), atWall(g, side, kMax, from),
    atWall(g, side, kMax, to), atWall(g, side, 1, to),
  ]);
  return style ? <i className={className} style={style} /> : null;
}

// 柱ごとのブラケット照明。**部屋の中に光源を実際に並べる**のが要点で、これが無いと
// 「どこからか明るい箱」にしかならない。大きさは その位置の壁の高さに比例させる。
function Sconces({ g, side }) {
  const [top, bot] = wallEdges(side);
  const kMax = wallKMax(g, side);
  const uMax = 1 - 1 / kMax;
  return DEPTHS.map((f, i) => {
    const k = Math.min(kOf(uMax * (f + COL_DEPTH / 2)), kMax);
    const [x, y] = atWall(g, side, k, 0.62);
    const wallH = Math.abs(g.at(top, k)[1] - g.at(bot, k)[1]);
    if (!(wallH > 0.5) || x < -6 || x > 106) return null;
    return (
      <i key={i} className="kj-lobby-sconce"
        style={{ left: `${x.toFixed(2)}%`, top: `${y.toFixed(2)}%`, height: `${(wallH * 0.045).toFixed(2)}%` }} />
    );
  });
}

// ─── 床と天井の石張り（同じ式で描く。違うのは基準の辺だけ） ─────────────────
// **目地は必ず消失点から引く。** 奥行き方向＝消失点からの放射、横方向＝等間隔（ROW_STEP）に
// 並んだ石を k で画面へ落とした段。石は1段ごとに色を変える——線だけだと方眼紙に、色だけだと
// 目地の無い床に見える。床にはさらに縁のインレイ帯（2本の放射）と、卓の手前のメダリオンを敷く。
function planeStyle(g, kind) {
  const floor = kind === "floor";
  const [a, b] = floor ? ["bl", "br"] : ["tl", "tr"];
  const kMax = Math.min(g.kExit(a), g.kExit(b));
  const farY = floor ? g.room.y1 : g.room.y0;
  const yAt = (k) => g.vp.y + (farY - g.vp.y) * k;

  const edges = [farY];
  for (let j = 1; j <= 14; j += 1) {
    const k = kOf(j * ROW_STEP);
    if (k > kMax) break;
    edges.push(yAt(k));
  }
  edges.sort((m, n) => m - n);

  const slabs = [];
  const joints = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const t = i / Math.max(1, edges.length - 1);
    const y0 = edges[i], y1 = edges[i + 1];
    // 1段ごとに石の色を変える（磨いた石は面ごとに向きが違うので明暗が交互になる）。
    const tint = i % 2 === 0 ? "rgba(244,231,191,0.05)" : "rgba(0,0,0,0.07)";
    slabs.push(`${tint} ${y0.toFixed(2)}%`, `${tint} ${y1.toFixed(2)}%`);
    // 目地は奥ほど細く薄く。太さまで一定にすると、そこだけ遠近が効いていない線になる。
    const w = 0.08 + t * 0.26;
    joints.push(
      `transparent ${(y1 - w).toFixed(2)}%`,
      `rgba(202,164,82,${(0.13 + t * 0.12).toFixed(2)}) ${y1.toFixed(2)}%`,
      `transparent ${(y1 + w).toFixed(2)}%`,
    );
  }

  const layers = [
    `linear-gradient(180deg, ${joints.join(", ")})`,
    // **放射の目地は本数を絞ること。** 6度刻みにした版は手前で30本以上に扇が開き、石ではなく
    // 縞板のデッキに見えた（消失点は正しいのに、線の密度だけで別の材質になる）。
    `repeating-conic-gradient(from 0deg at ${g.vp.x.toFixed(2)}% ${g.vp.y.toFixed(2)}%,`
      + ` rgba(202,164,82,0.1) 0deg 0.26deg, transparent 0.26deg 15deg)`,
    `linear-gradient(180deg, ${slabs.join(", ")})`,
  ];

  if (floor) {
    // 縁のインレイ帯。奥の辺の決まった位置を通る放射なので、床の目地と同じ点へ収束する。
    const ang = (x) => {
      const d = (Math.atan2(x - g.vp.x, -(farY - g.vp.y)) * 180) / Math.PI;
      return ((d % 360) + 360) % 360;
    };
    const [a1, a2, b1, b2] = [0.2, 0.245, 0.755, 0.8]
      .map((f) => ang(lerp(g.room.x0, g.room.x1, f)))
      .sort((m, n) => m - n);
    layers.push(`conic-gradient(from 0deg at ${g.vp.x.toFixed(2)}% ${g.vp.y.toFixed(2)}%,`
      + ` transparent 0deg ${a1.toFixed(2)}deg, rgba(232,200,116,0.12) ${a1.toFixed(2)}deg ${a2.toFixed(2)}deg,`
      + ` transparent ${a2.toFixed(2)}deg ${b1.toFixed(2)}deg,`
      + ` rgba(232,200,116,0.12) ${b1.toFixed(2)}deg ${b2.toFixed(2)}deg,`
      + ` transparent ${b2.toFixed(2)}deg 360deg)`);
    // メダリオン。床に描いた円は遠近では楕円になる。**縦の半径は前後の段の間隔から取ること**
    // ——画面の縦横比から決めると、幅の違う画面でその深さの1段に収まらなくなる。
    const kM = kOf(0.3);
    if (kM < kMax) {
      const rx = Math.abs(g.at("br", kM)[0] - g.at("bl", kM)[0]) * 0.22;
      const ry = Math.abs(yAt(kOf(0.38)) - yAt(kOf(0.22))) * 0.5;
      layers.push(`radial-gradient(${rx.toFixed(2)}% ${ry.toFixed(2)}% at 50% ${yAt(kM).toFixed(2)}%,`
        + ` rgba(232,200,116,0.05) 0 50%, rgba(232,200,116,0.17) 55% 62%, transparent 68%)`);
    }
    layers.push(`radial-gradient(46% 32% at 50% ${farY.toFixed(2)}%, rgba(232,200,116,0.2), transparent 74%)`);
    // 手前側も沈めすぎない（画面の下端で黒くなると、床がそこで終わって見える）。
    layers.push(`linear-gradient(180deg, #2b1f14 ${farY.toFixed(2)}%, #1d140d 100%)`);
  } else {
    // 天井は面として見える範囲が狭いので、**床と同じ明るさでは黒い帯になる**（実際にそうなった）。
    // シャンデリアの高さに当たる所を暖色で起こして、格間が読める値まで上げる。
    // **光を中央だけに集めないこと**：両端が黒く落ちると、天井がそこで切れて見える。
    layers.push(`radial-gradient(96% 62% at 50% ${farY.toFixed(2)}%, rgba(232,200,116,0.16), transparent 88%)`);
    layers.push(`linear-gradient(180deg, #191108 0%, #2c2014 ${farY.toFixed(2)}%)`);
  }
  return { backgroundImage: layers.join(", ") };
}

// ホールの背景。**操作できる物は1つも置かない**（aria-hiddenで読み上げからも外す）。
export function LobbyHall({ room }) {
  const g = room ? roomGeom(room) : null;
  return (
    <div className="kj-lobby-hall" aria-hidden="true">
      <LobbyBackdrop />
      {g && (
        <>
          {/* 面はどれも face() ＝「奥の辺の2隅を通る線が画面から出る所まで」で作る。
              **画面の隅と直接結ばないこと**（4本が1点で交わらず、面ごとに消失点が割れる）。 */}
          <div className="kj-lobby-ceiling" style={{ clipPath: poly(face(g, "tl", "tr")) }}>
            <div className="kj-lobby-vault" style={planeStyle(g, "ceiling")} />
          </div>
          <div className="kj-lobby-wall left" style={{ clipPath: poly(face(g, "bl", "tl")) }} />
          <div className="kj-lobby-wall right" style={{ clipPath: poly(face(g, "tr", "br")) }} />
          {/* 奥の壁。**アーチの肩に残る黒い面を壁として塞ぐ**——壁龕はアーチ形なので、その外側・
              矩形の内側（肩の三角）が今まで背景のまま抜けていた。冠の繰形と左右の落とし込みを
              持たせて、開口の周りを「壁」として見せる。 */}
          <div className="kj-lobby-endwall" style={{
            left: `${room.x0.toFixed(2)}%`, top: `${room.y0.toFixed(2)}%`,
            width: `${(room.x1 - room.x0).toFixed(2)}%`, height: `${(room.y1 - room.y0).toFixed(2)}%`,
          }} />
          {/* アーキボルト＝開口の周りに回す繰形。壁龕より一回り大きく敷いて後ろから覗かせる。 */}
          <div className="kj-lobby-archivolt kj-arch" style={{
            left: `${(room.x0 - (room.x1 - room.x0) * 0.03).toFixed(2)}%`,
            top: `${(room.y0 - (room.y1 - room.y0) * 0.035).toFixed(2)}%`,
            width: `${((room.x1 - room.x0) * 1.06).toFixed(2)}%`,
            height: `${((room.y1 - room.y0) * 1.035).toFixed(2)}%`,
          }} />
          {/* 床。**奥の辺は壁龕の下辺そのもの**——ここが合っていないと卓が床から浮く */}
          <div className="kj-lobby-floor" style={{ clipPath: poly(face(g, "br", "bl")) }}>
            <i style={planeStyle(g, "floor")} />
          </div>
          {/* 壁の上の物は奥から手前の順に重ねる：面 → 柱 → 境の光 */}
          <WallBays g={g} side="left" />
          <WallBays g={g} side="right" />
          <Colonnade g={g} side="left" />
          <Colonnade g={g} side="right" />
          {/* 壁面の分節。下から順に 幅木 → 腰壁の見切り → 軒 → 天井際のコーブ。 */}
          {["left", "right"].map((s) => (
            <Fragment key={s}>
              <WallBand g={g} side={s} from={0} to={0.045} className="kj-lobby-cove" />
              <WallBand g={g} side={s} from={0.17} to={0.205} className="kj-lobby-band dado" />
              <WallBand g={g} side={s} from={0.88} to={0.925} className="kj-lobby-band entab" />
              <WallBand g={g} side={s} from={0.965} to={1} className="kj-lobby-cove ceiling" />
              <Sconces g={g} side={s} />
            </Fragment>
          ))}
          {/* 空気遠近。消失点の周りだけ霞ませる＝奥は明るく眠く、手前は暗く締まる。
              値の差そのものが距離の手掛かりなので、**これが無いと箱を組んでも平らに見える。** */}
          <div className="kj-lobby-haze" style={{
            "--vp-x": `${g.vp.x.toFixed(2)}%`, "--vp-y": `${g.vp.y.toFixed(2)}%`,
          }} />
        </>
      )}
      <div className="kj-lobby-bokeh">
        {BOKEH.map((b, i) => (
          <i key={i} style={{
            left: `${b.x}%`, top: `${b.y}%`, width: b.r, height: b.r,
            "--d": `${b.d}s`, "--o": `${-b.o}s`,
          }} />
        ))}
      </div>
      <div className="kj-lobby-chandelier left" />
      <div className="kj-lobby-chandelier right" />
      <div className="kj-facade-uplight" />
    </div>
  );
}
