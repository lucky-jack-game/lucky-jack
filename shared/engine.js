// 1対1の対戦のルール本体（単一の情報源）。外部依存ゼロのplain ESMで、
// ブラウザ・Node両方からそのままimportできる（既存のshared/engine.jsと同じ方針）。
//
// 設計の要点:
//   ・カードはⅠ〜Ⅹ。**Ⅰだけが最上位を食う**（Ⅹにも Queen にも勝つ）
//   ・UP = Ⅵ〜Ⅹ ／ DOWN = Ⅰ〜Ⅴ **＋ Queen**
//   ・手札は2枚。1枚を伏せて出し、**使わなかった1枚は残る**。補充は勝負が決着してから
//   ・手札2枚のUP/DOWN内訳が毎局**両者に公表される**
//   ・同数字はその局のKING/JOKERを選んだ側（チューザー）が勝つ＝**引き分けを作らない**
//   ・賭けの単位は**ライフ**（整数）。アンティ1、レイズ上限なし
//
// **旧cardEngine.js（トーナメント/デッキ編成/ポイント経済）は削除済み。ルールはこのファイルにだけ書くこと**
// （同じ判定が2箇所に増えると必ず食い違う、というのがこのリポジトリの繰り返しの教訓）。

// ─── 乱数 ───
// シミュレータが同じ条件を再現できるよう、乱数源を差し替え可能にしておく。
// 既定はMath.randomなので、本番コードは今までどおり何も渡さなくてよい。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const defaultRng = Math.random;

// ─── カード ───
export const MIN_NUMBER = 1;
export const MAX_NUMBER = 10;
export const NUMBERS = Array.from({ length: MAX_NUMBER }, (_, i) => i + 1);

// UP/DOWNの境界。**Ⅵ以上がUP、Ⅴ以下がDOWN、Queenは常にDOWN。**
//
// Ⅰ〜Ⅴまで丸ごとDOWNに入れているのは、公表が答えを言ってしまうのを避けるため。
// カードがⅠ〜Ⅴしか無かった旧案（DOWN={Ⅰ,Ⅱ}）では「相手はDOWN-DOWN」という公表が
// 相手の手札を3通りまで絞ってしまい、ヒントではなくほぼ解答になっていた。
// 5/5で割ると DOWN-DOWN も UP-UP も15通りになり、「絞れるが分からない」という
// ブラフが成立する唯一の帯域に入る。
export const UP_THRESHOLD = 6;

// **Queenは公表上DOWN扱い**。これによりDOWNの中身が
// 「Ⅰ(最上位を食う)・Ⅴ(対DOWN無敗)・Queen(無条件勝利)・ただのゴミ札」と振れ幅最大になり、
//   UP  = 正直な信号（Ⅵ〜Ⅹしか無いので強気は概ね本物）
//   DOWN = 嘘つきの信号（最強も最弱も同じ顔で並ぶ）
// という**非対称**が生まれる。読み合いが起きるのは常にDOWN側で、Queenは「盤上でいちばん
// 危険な札がいちばん弱い顔で座っている」ことで特別になる。
// **この非対称は意図された設計であり、対称に戻してはいけない。**
export const BAND = { up: "up", down: "down" };

let cardSeq = 0;
export function makeNumberCard(number) {
  cardSeq += 1;
  return { id: `n${number}-${cardSeq}`, kind: "number", number };
}
export function makeQueenCard() {
  cardSeq += 1;
  return { id: `q-${cardSeq}`, kind: "queen", number: null };
}

export function cardBand(card) {
  if (card.kind === "queen") return BAND.down;
  return card.number >= UP_THRESHOLD ? BAND.up : BAND.down;
}

// 手札2枚のUP/DOWN内訳。これが毎局**両者に公表される**唯一の情報。
export function announceBands(hand) {
  let up = 0;
  for (const c of hand) if (cardBand(c) === BAND.up) up += 1;
  return { up, down: hand.length - up };
}

// ─── 強さの比較 ───
// **Ⅰだけが最上位を食う。** 旧仕様は「ⅠがⅤに勝つ」だけだったが、Jackを廃止したことで
// Queenのカウンターが不在になった——Jackだけ消すとQueenを引いた側がそのラウンドを確定で取り、
// 駆け引きが介在しない運のスパイクになる（＝ノイズとして排除したかった当のもの）。
// Ⅰはもともと最上位を食う例外札なので、その射程をQueenまで広げるだけで済む＝**新しいルールが
// 1つも増えない**。ⅠはDOWN側なので「公表上いちばん弱い札がQueenの天敵」というJackが
// 担っていた劇もそのまま残る。
function numberWins(a, b) {
  if (a === MIN_NUMBER && b === MAX_NUMBER) return true;
  if (a === MAX_NUMBER && b === MIN_NUMBER) return false;
  return a > b;
}

// 返り値は必ず "a" | "b"。**引き分けは構造的に発生しない**（同数字はチューザーが勝つ）。
// aIsChooser: cardAの持ち主がその局のKING/JOKER選択権者（チューザー）かどうか。
export function compareCards(cardA, cardB, aIsChooser) {
  const aQ = cardA.kind === "queen";
  const bQ = cardB.kind === "queen";
  // ① Ⅰ は Queen を食う
  if (aQ && !bQ && cardB.number === MIN_NUMBER) return "b";
  if (bQ && !aQ && cardA.number === MIN_NUMBER) return "a";
  // ② Queen の無条件勝利
  if (aQ) return "a";
  if (bQ) return "b";
  // ③ 数字（Ⅰ が Ⅹ を食う例外込み）
  if (cardA.number !== cardB.number) return numberWins(cardA.number, cardB.number) ? "a" : "b";
  // ④ 同数字はチューザー
  return aIsChooser ? "a" : "b";
}

// ─── モードとライフ ───
// ラウンド上限は「普段まず到達しない安全網」。ライフ側の時計の方がずっと短く、
// オールイン一発で終わりうるため。**カジュアルを短くしているのはライフ3の方で、
// ラウンド6は整合のために合わせているだけ**（ラウンド上限を半分にしても、元々到達して
// いないので試合時間はほとんど変わらない）。
// **数値は tools/simulate.mjs の実測で決めた**（2026-08-13、各20000試合）。
// 当て推量で動かさないこと——ここを変えたら必ず `npm run sim:op` を通してから出すこと。
//
//   ranked 7/15 … ノックアウト78.7% / 中央7局 / サドンデス1.7% / 逆転8.4% / 4.0分  → 5指標すべてOK
//   casual 6/8  … ノックアウト67.4% / 中央5局 / サドンデス2.8% / 逆転5.9% / 2.5分  → 逆転率のみ下回る
//
// **当初案の ranked 6/12 も4/5を満たす**（ノックアウト78.4% / 中央5局 / サドンデス1.9% /
// 逆転8.9% / 3.2分）。外したのは「中央6局以上」だけで、これは5指標のうち最も根拠が柔らかい
// （読みを作るのに何局要るかは測定ではなく判断）。戻すならこの2行を書き換えるだけでよい。
//
// **カジュアルの逆転率だけは構造的に届かない。** 逆転には局数が要るのに、カジュアルは短いことが
// 存在理由だから。ただしこの目標が防ぎたいのは「先行逃げ切りで残りが消化試合になること」で、
// **その害は劣勢でいる時間の長さに比例する**——短い試合では同じ数字でも害が小さいので、
// カジュアルの目標は5%に緩めてある（simulate.mjsのTARGETS参照）。
export const MODES = {
  ranked: { id: "ranked", lives: 7, rounds: 15 },
  casual: { id: "casual", lives: 6, rounds: 8 },
};
// 開始時のアンティ。**局が進むと上がる**（anteFor）。ここは1局目の額であり、下限でもある。
export const ANTE = 1;

// ─── アンティの段階（ポーカーのブラインドと同じ役割）───
//
// **「残り全部降りれば逃げ切れる」を潰すためのもの。** 消極的に打つ側が1局に失う額は、
// 降りればアンティ（即降りなら拠出はアンティだけ）、降りずに開示しても互いのアンティぶんだけ
// ——つまり**アンティが1局あたりの最大失点**。ライフの総和は一定なので差は偶数、1局で縮まるのは
// 最大 2×アンティ。よって残り局のアンティ合計を S とすると、**差が 2S+2 以上なら勝敗は確定**し、
// そこから先は消化試合になる。
//
// アンティが1で固定だと S = 残り局数 なので、**最終局は差4で確定**する——実測でカジュアルの
// 73.2%・ランクの77.2%が「最終局に入る時点で既に決まっている」状態だった（tools/measure-deadrounds.mjs）。
// 審査員が最後に見る局が4回に3回は無意味、ということ。
//
// **効いているのは局数ではなくアンティの積み上げなので、後半のアンティを上げれば窓が閉じる。**
// 局数を増やしても試合が長くなるだけで直らない。
//
// **段は「残り局数」で切る。試合の進行度（何割まで来たか）では切らない。**
// 逃げ切りが成立するかどうかは残り局数だけで決まるので、そこに直接紐づける方が効く。
// 副次的に、局数の違う2つのモードに同じ1行のルールがそのまま乗る
// （進行度で割ると、カジュアルの「最終局」とランクの「最終局」で額が変わってしまう）。
//
// 末尾から数えた額。[2,3] なら「残り2局で2、最終局で3、それ以外は1」。
//
// **[3] ＝「最終局だけアンティ3」を採る。実測で掃いた11通りの中でこれが最良だった**
// （tools/measure-deadrounds.mjs、各20000試合）。カジュアルで:
//
//   最後の局が勝負だった  44.8% → **63.8%**   （結果未確定 かつ ベット段階あり）
//   最終局が確定済み      73.2% → **32.3%**
//   ベット不能局          11.9% → **11.7%**   （＝対価はゼロ。むしろ下がる）
//   ノックアウト          62.5% →   65.4%     （目標55〜80%内）
//   逆転率                 5.9% →    7.0%     （長年の未達が改善。目標8%には未到達）
//
// **段を伸ばすほど良くなるわけではない。** [2,3] や [2,2,3] は「最後の局が勝負」を
// 60.5%/58.7% まで落とす——手前の局のアンティを上げると短スタックが早く削れ、最終局に
// 入る時点で既に開いてしまうため。**1局だけ上げるのが最も効く。**
// 同じ理由で額も3で頭打ちになる（[4] は [3] と実測が一致する。1局の拠出上限に当たるため）。
export const ANTE_TAIL = [3];

// round は1始まり。サドンデス（round > rounds）は末尾の額を使う。
export function anteFor(round, rounds, tail = ANTE_TAIL) {
  const t = Array.isArray(tail) && tail.length ? tail : ANTE_TAIL;
  const remaining = rounds - round + 1;        // この局を含む残り局数
  if (remaining <= 0) return t[t.length - 1];  // サドンデス
  const i = t.length - remaining;
  return i >= 0 ? t[i] : ANTE;
}

// ─── カードの供給（シュー） ───
// プールは「多めに作ってシャッフルし、半分を捨てる」。
// Ⅰ〜Ⅹを各12枚にしているのは、トランプ3セットで同じ数字が12枚ずつになるのと同じ比率だから。
export const COPIES_PER_RANK = 12;          // 10種 × 12枚 = 120枚
export const DISCARD_FRACTION = 0.5;        // 半分捨てる

// 1試合で実際に配られる枚数。初期手札2枚×2人 ＋ 各ラウンド後に1枚ずつ補充
// （最終ラウンドの後は補充不要）。ランク26枚 / カジュアル14枚。
export function cardsDealtInMatch(rounds) {
  return 4 + 2 * Math.max(0, rounds - 1);
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 60枚のうち26枚しか出ないので、**残り34枚の中身は最後まで分からない＝カウンティングが
// 成立しない**。
// デッキ編成を廃止した目的は複雑さの排除なので、**代わりにカウンティングという隠れた
// 技能層を生やさないこと**が要件だった。
//
// **Queenは必ず1枚存在する**。ただし素直に混ぜると登場率が
// 26/60 ≒ 43% ＝ ほぼコイン投げになり、**半分の試合で誰もQueenを見ないまま終わる**。
// 審査員が1〜2試合しか触らない以上、看板になる札が出ないのは損失が大きい。
//
// ── ここには構造的なトレードオフがある（実測で判明） ──
// 「ラウンド上限までに配られる26枚のどこかに挿す」だけでは足りない。**試合はラウンド上限まで
// 行かないから**で、実測では中央値7ラウンド（＝16枚）しか配られず、登場率は62〜70%に留まった。
// 挿す窓を狭めるほど登場率は上がるが、そのぶんQueenが必ず序盤に出る＝**出る時期が読める**ように
// なる。登場率と意外性は直接に競合するので、**どちらかを選ぶしかない**。
// QUEEN_WINDOW_ROUNDS_RATIO はそのつまみ（ラウンド上限に対する比）。
export const QUEEN_WINDOW_ROUNDS_RATIO = 0.34;

export function buildShoe(rounds, rng = defaultRng, windowRatio = QUEEN_WINDOW_ROUNDS_RATIO) {
  const pool = [];
  for (const n of NUMBERS) for (let i = 0; i < COPIES_PER_RANK; i++) pool.push(makeNumberCard(n));
  shuffle(pool, rng);
  const kept = pool.slice(0, Math.floor(pool.length * (1 - DISCARD_FRACTION)));
  const window = cardsDealtInMatch(Math.max(1, Math.ceil(rounds * windowRatio)));
  kept.splice(Math.floor(rng() * window), 0, makeQueenCard());
  return kept;
}

// ─── ベット（単位はライフ＝整数） ───
// 比率は1/2ポットと1ポットの2択。**旧仕様のCHIP_UNIT(10)の倍数という不変条件は不要**——
// 単位がライフ（整数1）になったので、端数でチップが半端に割れる問題自体が消えた。
export const RAISE_FRACTIONS = { half: 0.5, pot: 1 };

export function raiseAmount(pot, fraction = RAISE_FRACTIONS.half) {
  return Math.max(1, Math.floor((Number(pot) || 0) * fraction));
}

// **レイズは不足分(owed)を埋めてから上乗せする。** 旧cardEngine.jsのraiseCostと同じ理由:
// 上乗せ分だけを払う実装だと、最後の1回を除くレイズが誰にもマッチされないまま残り、
// 「コールするより、もう一段レイズし返す方が常に得」という一方向の歪みが生まれる
// （旧実装で実測: 非フォールド試合の26.9%で拠出が不一致、差は最大130pt）。
//
// **上乗せ幅はowedを足す前のポット（＝画面に出ているポット）から決める。** ポーカーの
// ポットリミットは「コールした後のポット」を基準にするが、それに倣うとボタンの"1ポット"
// というタグが実額と食い違い、レイズの応酬で額が急激に膨らむ。
export function raiseCost(pot, owed, fraction = RAISE_FRACTIONS.half) {
  const due = Math.max(0, Number(owed) || 0);
  const amt = raiseAmount(pot, fraction);
  return { owed: due, amt, total: due + amt };
}

export function normalizeRaiseFraction(f) {
  const n = Number(f);
  return Object.values(RAISE_FRACTIONS).includes(n) ? n : RAISE_FRACTIONS.half;
}

// 「その札のまま降りずに乗っていたらポットを取れていたか」。ナイスフォールド/バッドフォールドの判定。
// **カードの強弱をそのまま使ってはいけない**——JOKER(カードの敗者が総取り)では反転する。
export function wouldHaveWonPot(kjMode, cardWon) {
  return kjMode === "joker" ? !cardWon : !!cardWon;
}

// ─── 相手の手札の推定（公表からの逆算） ───
// 公表で分かるのは「UP/DOWNが何枚ずつか」だけ。そこから**相手が実際に場に出した1枚**の
// 分布を組み立てる。CPUの判断はすべてここを経由する。
//
// 相手がUP-UPなら出す札は必ずUP、DOWN-DOWNなら必ずDOWN。UP-DOWNのときだけどちらか
// 分からない——そして**KING/JOKERのどちらが宣言されたかで、相手がどちらを出したがるかが
// 変わる**ので、そこを織り込む。
const UP_RANKS = NUMBERS.filter((n) => n >= UP_THRESHOLD);
const DOWN_RANKS = NUMBERS.filter((n) => n < UP_THRESHOLD);

// DOWN帯に占めるQueenの割合。シューは120枚中Queen1枚なので、DOWN帯(60枚相当)に対して
// おおよそ1/61。**低いが0ではない**ことがDOWNを読みにくくしている当のものなので、
// 0に丸めないこと。
const QUEEN_WEIGHT_IN_DOWN = 1 / (DOWN_RANKS.length * COPIES_PER_RANK + 1);

// 相手が場に出した1枚の分布。返り値は [{card, p}] の配列（pの合計は1）。
export function opponentCardDistribution(oppBands, kjMode) {
  let pUp;
  if (oppBands.up >= 2) pUp = 1;
  else if (oppBands.up <= 0) pUp = 0;
  // UP1・DOWN1: KINGなら強い方(UP)を出しやすく、JOKERなら弱い方(DOWN)を出しやすい。
  // 断定はしない（0/1に振ると読み合いが消える）。
  else pUp = kjMode === "joker" ? 0.3 : 0.7;

  const out = [];
  for (const n of UP_RANKS) out.push({ card: { kind: "number", number: n }, p: pUp / UP_RANKS.length });
  const downShare = 1 - pUp;
  for (const n of DOWN_RANKS) {
    out.push({ card: { kind: "number", number: n }, p: (downShare * (1 - QUEEN_WEIGHT_IN_DOWN)) / DOWN_RANKS.length });
  }
  out.push({ card: { kind: "queen", number: null }, p: downShare * QUEEN_WEIGHT_IN_DOWN });
  return out;
}

// 「そのカードでカード比べに勝てる確率」。実際の勝敗判定には使わない目安。
// タイブレークはチューザー側が勝つので、自分がチューザーかどうかで値が変わる。
export function estimateHandConfidence(card, oppBands, kjMode, iAmChooser) {
  let p = 0;
  for (const { card: oc, p: w } of opponentCardDistribution(oppBands, kjMode)) {
    if (compareCards(card, oc, iAmChooser) === "a") p += w;
  }
  return p;
}

// 「そのカードで**ポットを取れる**確率」。estimateHandConfidenceが答えるのは
// 「カード比べに勝てそうか」であって、ポットを取れるかどうかではない——
// JOKER(カードの敗者が総取り)では両者が反転する。
//
// **この2つを取り違えるのはこのリポジトリで実際に起きた不具合**で、CPUがJOKERの局で
// 「これから負けてポットを渡す側」なのに強気に吊り上げ、勝てる手を降りるという完全に
// 逆の挙動をしていた。ベット判断に渡すのは必ずこちら。
export function estimatePotConfidence(card, oppBands, kjMode, iAmChooser) {
  const raw = estimateHandConfidence(card, oppBands, kjMode, iAmChooser);
  return kjMode === "joker" ? 1 - raw : raw;
}

// ─── CPUの意思決定 ───

// KING/JOKERの選択。**旧cardEngine.jsのchooseKJModeが持っていた確率(0.92/0.26)は
// GRAND SLAM遭遇率16%に合わせて調整された値**で、GRAND SLAMが消えた以上その縛りは無い。
// ここでの調整軸は「選択が読まれすぎないこと」だけ——確率を0/1に張り付けると
// 「KINGなら相手は強い」が常に真になり、ブラフの読み合いが消える。
export function chooseKJMode(bestConfidence, rng = defaultRng, probs = KJ_PROBS) {
  return bestConfidence >= 0.5
    ? (rng() < probs.highKing ? "king" : "joker")
    : (rng() < probs.lowJoker ? "joker" : "king");
}
export const KJ_PROBS = { highKing: 0.85, lowJoker: 0.7 };

// 手札2枚のどちらを出すか。**これが旧仕様に無かった意思決定**（旧作はカードが1枚
// ランダムに配られるだけで、局中の判断は「いくら賭けるか」しか無かった）。
//
// 素朴に「ポットを取れる確率が高い方」を常に選ばせないこと。定石は
// **UPを温存してDOWNを消費する**ことで、公表を「UP1・DOWN1」に保ちDOWN-DOWN
// （＝弱いと確定する状態）へ落ちないようにする点にある。retentionBiasがその重み。
export function chooseCPUCard(hand, oppBands, kjMode, iAmChooser, rng = defaultRng, opts = {}) {
  const retentionBias = opts.retentionBias ?? 0.12;
  const noise = opts.noise ?? 0.1;
  const scored = hand.map((card, index) => {
    const now = estimatePotConfidence(card, oppBands, kjMode, iAmChooser);
    // 残る側の札の素の強さ（＝次局以降の価値）。高い札を手元に残せる選択を少しだけ優遇する。
    const other = hand[1 - index];
    const keepValue = other.kind === "queen" ? 1 : (other.number - MIN_NUMBER) / (MAX_NUMBER - MIN_NUMBER);
    return { index, score: now + retentionBias * keepValue };
  });
  scored.sort((a, b) => b.score - a.score);
  return rng() < noise ? scored[1].index : scored[0].index;
}

// ベット行動。**レイズ上限は無い**ので、旧実装のraiseCount上限による
// 打ち切りは持たない。降りるか、乗るか、積むか。
export const CPU_BET_PARAMS = {
  bluffRate: 0.15,
  raiseThreshold: 0.62,
  callThreshold: 0.35,
  looseCallRate: 0.3,
  // **スタックのどれだけを突っ込むかで閾値を吊り上げる係数。**
  //
  // 初版はこれを持っておらず、CPUは「自信 > 閾値」だけで積んでいた。旧実装には
  // MAX_RAISES(3)という打ち切りがあったので露見しなかったが、レイズ上限を外した途端に
  // **自信が閾値を超えている限り無制限に積み続ける**挙動になり、実測でオールイン率32%・
  // ノックアウト決着率92%（目標50〜70%）になった。
  //
  // 重要なのは、これが**ライフを増やしても直らない**こと: レイズがポット比率なので
  // ポットは指数的に育ち、スタックの深さに関わらず log2(stack/ante) ≒ 3回程度の
  // 応酬でオールインに達する（実測でも8ライフのノックアウト率は71%で、6ライフの
  // 92%からたいして下がらなかった）。**ゲームバランスではなくCPUのモデルの欠落**であり、
  // 実際の打ち手は積むほど慎重になる。
  commitPressure: 0.45,
  // **スタックが浅いほどcommitPressureを弱める。** アンティ何個ぶんのスタックを持っているかで測り、
  // これを下回ると「押すか降りるか」しかない領域とみなす。
  //
  // commitPressureだけを入れた版は、追い込まれた側ほど降りやすくなった——短スタックにとっては
  // **どの行動もスタックの高割合**になるので、圧が常に最大でかかってしまう。しかし降り続ければ
  // アンティだけで死ぬので、実際の短スタック戦略は逆に「広く押す」になる。
  // 実測でも逆転率（＝崖に立ってから勝つ確率）が4〜9%と低く、先行逃げ切りゲーになっていた。
  shortStackAntes: 6,
};

// **bluffRateを下げないこと。** 旧実装での測定では下げるとスコアは上がったが、
// それは「適応しないボット」に対してのみ成立する。ブラフを止めたCPUは「レイズ＝強い」が
// 常に真になるので、人間には一発で読まれ、レイズには降り・チェックには押す、で刈られる。
//
// ctx.commitment: この行動を取った後に自分のスタックの何割を拠出することになるか(0〜1)。
// ctx.stackAntes: 自分の残りライフがアンティ何個ぶんか。浅いほど圧を弱める。
// ctx.toCall:     いま払う額。0＝誰もまだ積んでいない（＝降りる意味が無い）。
// どれも渡さなければ従来どおりの挙動（commitment=0＝圧なし、降りられる局面として扱う）。
export function chooseCPUBetAction(potConfidence, ctx = {}, rng = defaultRng, p = CPU_BET_PARAMS) {
  const bluff = rng() < p.bluffRate;
  const effective = bluff ? Math.min(1, potConfidence + 0.4) : potConfidence;
  const commit = Math.max(0, Math.min(1, ctx.commitment ?? 0));
  // スタックが浅いほど圧を薄める。降り続けてもアンティで死ぬので、慎重さが利益にならない領域。
  const depth = ctx.stackAntes == null ? 1 : Math.min(1, Math.max(0, ctx.stackAntes) / p.shortStackAntes);
  const pressure = p.commitPressure * depth;
  // 深く突っ込むほど必要な確信を上げる。コール側の圧はレイズ側の6割にしておく
  // （降りるほど相手にタダで場を譲るのは本作でも同じなので、降ろしすぎない）。
  const raiseBar = p.raiseThreshold + pressure * commit;
  const callBar = p.callThreshold + pressure * commit * 0.6;
  // **払う額が0の局面では降りない。** タダで見られる開示を捨ててアンティを相手に渡すだけの手で、
  // どの自信度でも損しかしない（チェックすれば同じ0でカードの勝負まで行ける）。
  // 人間が押したフォールドは額に関わらずその場で成立させる（match.js の betAction）ので、
  // ここで弾かないとCPUだけが「降りたつもりのチェック」から本物のフォールドに変わり、
  // 実測で決めたノックアウト率・逆転率が静かに動く。
  const passive = (ctx.toCall ?? 1) > 0 ? "fold" : "call";
  // オールイン相当まで積み上がっている局面ではレイズできないので、乗るか降りるかだけ。
  if (ctx.canRaise === false) return effective > callBar ? "call" : passive;
  if (effective > raiseBar) return "raise";
  if (effective > callBar) return "call";
  return rng() < p.looseCallRate ? "call" : passive;
}

// レイズ幅。**幅を手の強さと完全に相関させないこと**——幅そのものが手の強さを漏らす
// テルになり、ブラフの読み合いが「幅を見るだけ」に退化する（CPUの思考時間を
// 行動の種類と相関させないのと全く同じ理由）。
export function chooseCPURaiseFraction(potConfidence, rng = defaultRng) {
  const big = potConfidence > 0.8 ? 0.55 : potConfidence > 0.6 ? 0.3 : 0.15;
  return rng() < big ? RAISE_FRACTIONS.pot : RAISE_FRACTIONS.half;
}

// ─── 1局の解決 ───
// ライフの受け渡しは完全なゼロサム（総量はモードの lives×2 で常に一定）。
// **アンティがあるので降り続けても死ぬ**——だから「リードしたら降りて時間切れを狙う」
// という腐り方が構造的に起きず、ラウンド上限を安全に置ける。

// ヘッズアップなので**サイドポットは作らない**。両者が出せる上限を min(lives) に
// 揃えることで、超過分が発生しないようにする（返却処理も不要になる）。
export function effectiveStack(livesA, livesB) {
  return Math.min(livesA, livesB);
}

// ─── 1局に賭けられるライフの上限 ───
// **1局で試合が終わらないようにするための唯一の歯止め。**
//
// 上限を min(lives) だけにしていた版は、実測で**局の24.9%（カジュアル）がオールイン**に
// なっていた。1局目のオールインはそのまま試合の決着なので、**ノックアウトのかなりの割合が
// 1局で終わる**という状態だった——審査員が1〜2試合しか触らない前提では、ゲームを見せる前に
// 終わる可能性がそれだけあるということになる。
//
// **レイズ回数の上限では直らない。** 実測の1局あたりレイズ回数は平均0.97・最大4しかなく、
// 3回で打ち切っても何も変わらない。効いているのは回数ではなく**額の伸び方**で、レイズが
// ポット比率である以上ポットは指数的に育ち、2回の応酬で min(lives) に届く。
// だから歯止めは「1局の拠出そのもの」に置く。
//
// **上限は「開始ライフ − 1」。** 比率で決めていないのは、守りたい性質が比ではなく
// 「**1局では相手を削り切れない＝どんなに積んでも必ず1ライフ残る**」という一点だからで、
// それを満たす最大の値がこれになる（＝読み合いの余地を1ライフも余計に削らない）。
// 副産物として、プレイヤーに説明する文が1行で済む。
//
// 開始ライフに対して取ること（残りライフから毎局引き直すと、削られた側ほど1局に張れる額も
// 縮んで**追い込まれるほど巻き返せなくなる**）。実測でも比率で刻んだ版より素直で、
// カジュアル上限5・ランク上限6のとき1局決着は 12.6%/10.4% → **どちらも0%** になり、
// ランクは5指標すべてが目標内に収まったまま2局以内の決着も 16.0% → 8.8% に下がった。
//
// ratio はシミュレータが「比を掃く」ためだけの入口（--capratio）。本番は必ず既定の側を通る。
export function roundBetCap(startLives, ratio = null, tiers = ANTE_TAIL) {
  const lives = Number(startLives) || 0;
  const raw = ratio == null ? lives - 1 : Math.ceil(lives * ratio);
  // **最大のアンティを下回ると、後半の局がベット不能になる。** 上限はアンティより必ず大きいこと
  // （アンティ=上限だと開始時点で room が0になり、宣言とカード選択しか残らない）。
  const maxAnte = Math.max(...(Array.isArray(tiers) && tiers.length ? tiers : ANTE_TAIL));
  return Math.max(maxAnte + 1, raw);
}
