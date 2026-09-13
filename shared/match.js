// 1試合の進行そのもの（局の開始・宣言・カード選択・ベット・決着）を、**通信もタイマーも持たない
// 純粋な状態機械**として置く。server/match.js はこれに配信を被せるだけ、CPU練習はこれを
// 直接回すだけ、にする。
//
// ── なぜ抜き出すのか ──
// 旧実装は同じルールをサーバーと画面の2箇所に
// 実装しており、記録していた不具合のかなりの割合が「片方だけ直した」に由来する
// （連勝の数え方が両方壊れていて壊れ方が逆だった件が典型）。**現行ルールでは最初から
// 1つにする。** ここに無いのは「誰にどこまで見せるか」と「いつ待つか」だけで、それは
// 通信層（server/match.js）とUI層の仕事。
//
// 状態はプレーンなオブジェクトを直接書き換える（サーバーが既にその形で書かれているため）。
// 乱数は必ず引数で受ける——シミュレータとテストが再現できる必要がある。
import {
  ANTE, ANTE_TAIL, anteFor, buildShoe, announceBands, compareCards,
  chooseKJMode, chooseCPUCard, chooseCPUBetAction, chooseCPURaiseFraction,
  estimateHandConfidence, estimatePotConfidence,
  raiseCost, normalizeRaiseFraction, effectiveStack, roundBetCap,
} from "./engine.js";

export const PHASE = { KJ: "kj", CARD: "card", BETTING: "betting", REVEAL: "reveal", DONE: "done" };

export function createMatch({ ids, lives, rounds, rng = Math.random, shoe, capRatio, anteTail = ANTE_TAIL }) {
  const [a, b] = ids;
  const m = {
    ids: [a, b], lives: { [a]: lives, [b]: lives },
    startLives: lives, rounds,
    // 1局に賭けられるライフの上限。**試合の途中で変わらない**（残りライフから毎局引き直すと、
    // 削られた側ほど1局に張れる額も縮んで巻き返しが構造的に効かなくなる）。
    // capRatio はシミュレータが比を掃くためだけの入口で、本番は既定値を使う。
    roundCap: roundBetCap(lives, capRatio, anteTail),
    // アンティの段。**試合の途中で差し替えないこと**（局ごとの額は anteFor が決める）。
    anteTail,
    ante: ANTE,
    hands: { [a]: [], [b]: [] },
    shoe: shoe || buildShoe(rounds, rng), shoeIdx: 0,
    round: 0, roundsPlayed: 0, suddenDeath: false,
    chooserId: rng() < 0.5 ? a : b,
    phase: PHASE.KJ, kjMode: null, picks: {}, bands: {},
    contrib: {}, cap: 0, pendingAmount: 0, pendingRaise: false, checkedBy: null,
    folded: null, turn: null,
    ended: null, // { reason, winnerId|null }
    rng,
  };
  for (const id of m.ids) draw(m, id, 2);
  return m;
}

export const other = (m, id) => (id === m.ids[0] ? m.ids[1] : m.ids[0]);
export const potOf = (m) => m.contrib[m.ids[0]] + m.contrib[m.ids[1]];

function draw(m, id, n) {
  for (let i = 0; i < n; i++) {
    if (m.shoeIdx >= m.shoe.length) break; // 設計上は起きない（シューは1試合ぶんに足りる）
    m.hands[id].push(m.shoe[m.shoeIdx++]);
  }
}

// 局を開始する。ラウンド上限に達していれば試合を畳む（同数のときだけサドンデスで1局延長）。
// 戻り値 true = 局が始まった / false = 試合が終わった（m.ended を見ること）。
export function beginRound(m) {
  if (m.ended) return false;
  if (m.round >= m.rounds && !m.suddenDeath) {
    const [a, b] = m.ids;
    if (m.lives[a] !== m.lives[b]) { endMatch(m, "roundLimit"); return false; }
    m.suddenDeath = true;
  }
  m.round += 1;
  m.phase = PHASE.KJ;
  m.kjMode = null;
  m.picks = {};
  m.folded = null;
  m.bands = Object.fromEntries(m.ids.map((id) => [id, announceBands(m.hands[id])]));
  return true;
}

export function declareKJ(m, mode) {
  if (m.phase !== PHASE.KJ) return false;
  if (mode !== "king" && mode !== "joker") return false;
  m.kjMode = mode;
  m.phase = PHASE.CARD;
  return true;
}

// 未宣言のまま締切を迎えたとき用。**罰にはしない**（その人の手札から素直に選ぶ）。
export function autoDeclareKJ(m) {
  const hand = m.hands[m.chooserId];
  const best = Math.max(...hand.map((c) => estimateHandConfidence(c, m.bands[other(m, m.chooserId)], "king", true)));
  return declareKJ(m, chooseKJMode(best, m.rng));
}

// 出し直しは認めない（相手の様子を見てから選べてしまう）。
export function pickCard(m, id, cardId) {
  if (m.phase !== PHASE.CARD || m.picks[id]) return false;
  const i = m.hands[id].findIndex((c) => c.id === cardId);
  if (i < 0) return false;
  m.picks[id] = m.hands[id].splice(i, 1)[0];
  return true;
}

export function autoPickCard(m, id) {
  if (m.picks[id]) return false;
  const i = chooseCPUCard(m.hands[id], m.bands[other(m, id)], m.kjMode, m.chooserId === id, m.rng);
  m.picks[id] = m.hands[id].splice(i, 1)[0];
  return true;
}

export const bothPicked = (m) => m.ids.every((id) => m.picks[id]);

// この局のアンティ。**beginBetting より前（宣言フェーズ）から確定している**ので、
// 画面は round_start の時点でこれを出せる——アンティが3の局かどうかは KING/JOKER の
// 宣言そのものに効くため、賭けが始まってから知らせたのでは遅い。
//
// **UIとベット処理で別々に計算しないこと。** beginBetting もこれを呼ぶ。
// 切り下げ（cap-1）まで含めた「実際に置かれる額」を返すので、画面の数字と卓の灯りが必ず一致する。
export function anteOfRound(m) {
  const [a, b] = m.ids;
  const cap = Math.min(effectiveStack(m.lives[a], m.lives[b]), m.roundCap);
  const want = anteFor(m.round, m.rounds, m.anteTail);
  return cap <= 1 ? cap : Math.min(want, cap - 1);
}

export function beginBetting(m) {
  const [a, b] = m.ids;
  m.phase = PHASE.BETTING;
  // 拠出の上限は2つの制約の小さい方。
  //   ・effectiveStack … 持っていない分は出せない（ヘッズアップなのでサイドポットを作らない）
  //   ・roundCap       … **1局で試合を終わらせないための歯止め**（engine.js の roundBetCap）
  // 上限に達すると betContext の canRaise が false になり、UIもCPUも自動的に「乗るか降りるか」
  // だけになる——レイズを止める処理を別に書かない。
  m.cap = Math.min(effectiveStack(m.lives[a], m.lives[b]), m.roundCap);
  // **アンティは最終局だけ上がる**（engine.js の ANTE_TAIL。「残り全部降りて逃げ切る」を潰すため）。
  //
  // **ただしアンティが積む余地を食い潰さないよう切り下げる**（anteOfRound の cap-1）。
  // 局がベット不能になるのは「短い方の残りライフ ≤ アンティ」のときなので、切り下げないと
  // アンティを上げた分だけその帯が広がる——実測で**ベット不能局で試合が終わる割合が
  // 27.9% → 47.0%** まで悪化した（カジュアル）。それは「コールの段階なしで
  // カードを選んだだけで決着する」そのものなので、消化試合を消すために別の壊れ方を買うことになる。
  // 切り下げれば帯は現行のまま（ベット不能は cap<=1＝短い方が残り1ライフの局だけ）で、
  // 実測のベット不能局は 11.9% → 11.7% と**むしろ下がる**。
  m.ante = anteOfRound(m);
  const ante = m.ante;
  m.contrib = { [a]: ante, [b]: ante };
  m.pendingAmount = 0;
  m.pendingRaise = false;
  m.checkedBy = null;
  // **先に行動するのは宣言しなかった側**（チューザーが先に情報を出したことへの対価）。
  m.turn = other(m, m.chooserId);
}

// いま手番の人が取りうる選択肢の状況。UIもCPUもここを見る（2箇所で別々に計算しない）。
export function betContext(m, id = m.turn) {
  const toCall = m.contrib[other(m, id)] - m.contrib[id];
  const room = m.cap - m.contrib[id];
  return { toCall, room, canRaise: room > toCall && m.contrib[other(m, id)] < m.cap };
}

// 戻り値 true = ベット終了（開示へ）。不正な action は安全側（call/check）へ倒す。
export function betAction(m, id, action, fraction) {
  if (m.phase !== PHASE.BETTING || m.turn !== id) return false;
  const opp = other(m, id);
  const { toCall, room, canRaise } = betContext(m, id);

  // **フォールドは押されたら押された通りに畳む。払う額が0でも同じ。** 以前はここに
  // `&& toCall > 0` が付いており、誰もまだ積んでいない局面のフォールドが無言でチェックに
  // 化けていた——**相手がKING/JOKERを宣言した局では必ずこちらが先に打つ**（beginBetting が
  // 手番を非チューザーに渡す）ので、フォールドを押しても場が続き、相手のレイズを待って
  // もう一度押す必要があった。パネルにはチェックのボタンが別にあるので、
  // フォールドを押した人は明確に降りることを選んでいる＝ボタンに嘘を書かないこと。
  // 失うのは自分の拠出＝アンティだけで、アンティの計算（即降りの拠出はアンティ）
  // とも一致する。**CPUは払う額が0なら降りない**（engine.js の chooseCPUBetAction）ので、
  // タダで場を捨てる手が自動で打たれることはない。
  if (action === "fold") { m.folded = id; m.phase = PHASE.REVEAL; return true; }
  if (action === "raise" && canRaise) {
    // **不足分(owed)を先に埋めてから上乗せする。** 埋めないと未マッチの拠出が残り、
    // 「コールするより、もう一段レイズし返す方が常に得」という一方向の歪みになる。
    const { amt, total } = raiseCost(potOf(m), toCall, normalizeRaiseFraction(fraction));
    m.contrib[id] += Math.min(total, room);
    m.pendingRaise = true;
    m.pendingAmount = amt;
    m.checkedBy = null;
    m.turn = opp;
    return false;
  }
  if (toCall > 0) { // call
    m.contrib[id] += Math.min(toCall, room);
    m.pendingRaise = false;
    m.pendingAmount = 0;
    m.phase = PHASE.REVEAL;
    return true;
  }
  // check
  if (m.checkedBy && m.checkedBy !== id) { m.phase = PHASE.REVEAL; return true; }
  m.checkedBy = id;
  m.turn = opp;
  return false;
}

// 両者オールインでこれ以上積めない局面（ベットを回さずそのまま開示する）。
export const bettingExhausted = (m) => betContext(m).room <= 0;

// CPUの一手。**ベット判断に渡すのは estimatePotConfidence**（KING/JOKERを踏まえた
// 「ポットを取れそうか」）であって、カード比べに勝てるかどうかではない——JOKERでは反転する。
export function cpuBetDecision(m, id) {
  const { canRaise, toCall } = betContext(m, id);
  const conf = estimatePotConfidence(m.picks[id], m.bands[other(m, id)], m.kjMode, m.chooserId === id);
  const action = chooseCPUBetAction(conf, {
    // **toCall を渡すのは「降りられる局面か」を判断させるため。** 0のときに降りるのは
    // タダの開示を捨ててアンティを渡すだけの手なので、CPUには打たせない。
    canRaise, toCall,
    // 深く突っ込むほど慎重に、ただしスタックが浅いときは逆に広く押す（shared/engine.js 参照）。
    commitment: m.cap > 0 ? (m.contrib[id] + toCall) / m.cap : 0,
    stackAntes: m.lives[id] / (m.ante || ANTE),
  }, m.rng);
  return { action, fraction: chooseCPURaiseFraction(conf, m.rng) };
}

export function cpuKJDecision(m) {
  const best = Math.max(...m.hands[m.chooserId].map(
    (c) => estimateHandConfidence(c, m.bands[other(m, m.chooserId)], "king", true),
  ));
  return chooseKJMode(best, m.rng);
}

// 決着。**本戦（カード比べ）は降りた局でも必ず判定する**（決着後は両者のカードを公開するので
// 嘘にならず、「降りたのが正解だったか」の答え合わせがその場でできる）。
export function resolveRound(m) {
  const [a, b] = m.ids;
  m.phase = PHASE.REVEAL;
  const cardWinnerId = compareCards(m.picks[a], m.picks[b], m.chooserId === a) === "a" ? a : b;
  const potWinnerId = m.folded
    ? other(m, m.folded)
    : (m.kjMode === "joker" ? other(m, cardWinnerId) : cardWinnerId);
  const potLoserId = other(m, potWinnerId);
  const moved = m.contrib[potLoserId];

  m.lives[potWinnerId] += moved;
  m.lives[potLoserId] -= moved;
  m.roundsPlayed += 1;

  const result = {
    // **pot は卓に乗っていた実額（potOf）、moved は実際に動いたライフ。** 降りた局では
    // 拠出が揃わないので2つは一致しない——降りた側の拠出ぶんだけが動き、乗っていた側の
    // 上乗せは自分に戻る。`moved * 2` を pot と呼んでいた版は、フェルトに4つ灯っていた局を
    // 「ポット2」と報告していた（実測で局の約半分＝降りた局すべてで食い違っていた）。
    cardWinnerId, potWinnerId, potLoserId, moved, pot: potOf(m),
    folded: m.folded, kjMode: m.kjMode,
    cards: { [a]: m.picks[a], [b]: m.picks[b] },
    lives: { ...m.lives },
  };

  if (m.ids.some((id) => m.lives[id] <= 0)) endMatch(m, "knockout");
  else if (m.suddenDeath) endMatch(m, "suddenDeath");
  else {
    // 補充と、次の宣言権の移動。**次に宣言するのはポットを失った側。**
    for (const id of m.ids) draw(m, id, 1);
    m.chooserId = potLoserId;
  }
  return result;
}

export function endMatch(m, reason) {
  const [a, b] = m.ids;
  const winnerId = m.lives[a] === m.lives[b] ? null : (m.lives[a] > m.lives[b] ? a : b);
  m.phase = PHASE.DONE;
  m.ended = { reason, winnerId };
  return m.ended;
}

// 切断・投了。**CPUに引き継がせない**（オンラインにCPUを置かない方針の当然の帰結）。
export function forfeit(m, loserId) {
  m.lives[loserId] = 0;
  m.lives[other(m, loserId)] = Math.max(1, m.lives[other(m, loserId)]);
  return endMatch(m, "forfeit");
}
