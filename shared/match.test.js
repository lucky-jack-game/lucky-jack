// shared/match.js のユニットテスト。
// server/match.test.js（実サーバー＋2クライアント）が配信と順序を見るのに対し、こちらは
// **試合全体を通したときに壊れてはいけない不変条件**を見る。1局だけを見る統合テストでは
// 取りこぼす種類（ライフ総量の保存、宣言権の移動、サドンデス）を担当する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, MODES, ANTE, ANTE_TAIL, anteFor, roundBetCap } from "./engine.js";
import {
  PHASE, createMatch, other, potOf, beginRound, declareKJ, autoDeclareKJ,
  pickCard, autoPickCard, bothPicked, beginBetting, betAction, betContext,
  bettingExhausted, resolveRound, cpuBetDecision, cpuKJDecision, forfeit,
} from "./match.js";

// CPU同士で1試合を最後まで回す。テストが自前でルールを書かないよう、進行は全部本体に任せる。
function autoPlay(seed, opts = {}) {
  const rng = mulberry32(seed);
  const m = createMatch({ ids: ["a", "b"], lives: opts.lives ?? 6, rounds: opts.rounds ?? 8, rng });
  const log = [];
  while (!m.ended) {
    if (!beginRound(m)) break;
    declareKJ(m, cpuKJDecision(m));
    for (const id of m.ids) autoPickCard(m, id);
    beginBetting(m);
    let guard = 0;
    while (m.phase === PHASE.BETTING && guard++ < 200) {
      if (bettingExhausted(m)) break;
      const id = m.turn;
      const { action, fraction } = cpuBetDecision(m, id);
      betAction(m, id, action, fraction);
    }
    log.push({ contrib: { ...m.contrib }, folded: m.folded, ...resolveRound(m) });
  }
  return { m, log };
}

test("ライフ総量は試合を通して保存される（完全なゼロサム）", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { m } = autoPlay(seed);
    const total = m.lives.a + m.lives.b;
    assert.equal(total, m.startLives * 2, `seed=${seed} で総量が ${total} になった`);
  }
});

test("降りずに決着した局は両者の拠出が必ず一致する", () => {
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (const e of autoPlay(seed).log) {
      if (e.folded) continue;
      checked += 1;
      assert.equal(e.contrib.a, e.contrib.b, `seed=${seed} で拠出が揃っていない`);
    }
  }
  assert.ok(checked > 50, `検査した局が少なすぎる (${checked})`);
});

test("試合は必ず終わる（ラウンド上限かノックアウト）", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { m } = autoPlay(seed);
    assert.ok(m.ended, `seed=${seed} で終わっていない`);
    assert.ok(["knockout", "roundLimit", "suddenDeath"].includes(m.ended.reason));
    // ラウンド上限を超えて打たれることはない（サドンデスの1局だけが例外）。
    assert.ok(m.roundsPlayed <= m.rounds + 1, `局数が上限を超えた: ${m.roundsPlayed}`);
  }
});

test("サドンデスは必ず決着する（引き分けのまま終わらない）", () => {
  let saw = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { m } = autoPlay(seed);
    if (m.ended.reason !== "suddenDeath") continue;
    saw += 1;
    // 毎局アンティで最低1ライフが動くので、延長した1局で必ず差がつく。
    assert.notEqual(m.lives.a, m.lives.b, `seed=${seed} でサドンデス後も同数`);
    assert.ok(m.ended.winnerId);
  }
  assert.ok(saw > 0, "サドンデスが一度も起きず検査できていない");
});

test("次に宣言するのはポットを失った側", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = mulberry32(seed);
    const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng });
    beginRound(m);
    declareKJ(m, "king");
    for (const id of m.ids) autoPickCard(m, id);
    beginBetting(m);
    while (m.phase === PHASE.BETTING && !bettingExhausted(m)) {
      const id = m.turn;
      betAction(m, id, "check");
      if (m.phase !== PHASE.BETTING) break;
    }
    const r = resolveRound(m);
    if (m.ended) continue;
    assert.equal(m.chooserId, r.potLoserId);
  }
});

test("先に行動するのは宣言しなかった側", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(9) });
  beginRound(m);
  declareKJ(m, "king");
  for (const id of m.ids) autoPickCard(m, id);
  beginBetting(m);
  assert.equal(m.turn, other(m, m.chooserId));
  assert.equal(potOf(m), ANTE * 2);
});

test("カードの出し直しは受け付けない", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(4) });
  beginRound(m);
  declareKJ(m, "king");
  const first = m.hands.a[0], second = m.hands.a[1];
  assert.equal(pickCard(m, "a", first.id), true);
  assert.equal(pickCard(m, "a", second.id), false, "2枚目が通ってしまった");
  assert.equal(m.picks.a.id, first.id);
  assert.equal(bothPicked(m), false);
});

test("手番でない側のベットは無視される", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(5) });
  beginRound(m); declareKJ(m, "king");
  for (const id of m.ids) autoPickCard(m, id);
  beginBetting(m);
  const idle = other(m, m.turn);
  const before = potOf(m);
  assert.equal(betAction(m, idle, "raise", 1), false);
  assert.equal(potOf(m), before);
});

test("拠出はスタックの上限を超えない（サイドポットが生まれない）", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { log } = autoPlay(seed, { lives: 4, rounds: 12 });
    for (const e of log) {
      assert.ok(e.contrib.a <= 4 + 12, "拠出が異常に膨らんでいる");
      // 降りていない局は必ず一致し、かつ両者ともcapを超えない。
      if (!e.folded) assert.equal(e.contrib.a, e.contrib.b);
    }
  }
});

test("フォールドしても本戦の勝敗は判定される", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(11) });
  beginRound(m); declareKJ(m, "king");
  for (const id of m.ids) autoPickCard(m, id);
  beginBetting(m);
  const first = m.turn;
  betAction(m, first, "raise", 1);
  const done = betAction(m, other(m, first), "fold");
  assert.equal(done, true);
  const r = resolveRound(m);
  assert.equal(r.folded, other(m, first));
  assert.equal(r.potWinnerId, first);
  // **降りた局でもカード比べは走る**（決着後に両者のカードを公開するので嘘にならない）。
  assert.ok(["a", "b"].includes(r.cardWinnerId));
  assert.ok(r.cards.a && r.cards.b);
});

// **払う額が0でもフォールドは1回で成立する。** 以前は `fold && toCall > 0` だったため、
// 誰もまだ積んでいない局面（＝宣言しなかった側の第一手。相手がKING/JOKERを宣言した局では
// 必ずここから始まる）のフォールドが無言でチェックに化け、相手のレイズを待ってもう一度
// 押さないと降りられなかった。押した通りに畳むこと。
test("払う額が0でもフォールドはその場で成立する", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(7) });
  beginRound(m); declareKJ(m, "king");
  for (const id of m.ids) autoPickCard(m, id);
  beginBetting(m);
  const first = m.turn;
  assert.equal(first, other(m, m.chooserId), "先に打つのは宣言しなかった側");
  assert.equal(betContext(m, first).toCall, 0, "まだ誰も積んでいない");

  const livesBefore = { ...m.lives };
  assert.equal(betAction(m, first, "fold"), true, "1回目のフォールドで畳まれていない");
  const r = resolveRound(m);
  assert.equal(r.folded, first);
  assert.equal(r.potWinnerId, other(m, first));
  // 失うのは自分の拠出＝アンティだけ（アンティの計算が置いている前提）。
  assert.equal(r.moved, m.ante);
  assert.equal(m.lives[first], livesBefore[first] - m.ante);
});

// **CPUは払う額が0のときに降りない。** フォールドを額に関わらず成立させたので、ここを
// 塞がないとCPUの「降りたつもりのチェック」が本物のフォールドに変わり、タダで場を捨てる手を
// 打ち始める＝実測で決めたノックアウト率・逆転率が静かに動く（engine.js の chooseCPUBetAction）。
test("CPUは払う額が0の局面では降りない", () => {
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(seed) });
    beginRound(m); declareKJ(m, cpuKJDecision(m));
    for (const id of m.ids) autoPickCard(m, id);
    beginBetting(m);
    if (bettingExhausted(m)) continue;
    assert.equal(betContext(m, m.turn).toCall, 0);
    checked += 1;
    assert.notEqual(cpuBetDecision(m, m.turn).action, "fold", `seed=${seed} でタダ降りした`);
  }
  assert.ok(checked > 50, `検査した局が少なすぎる (${checked})`);
});

test("投了・切断は残った側の勝ちで畳む", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(7) });
  const e = forfeit(m, "a");
  assert.equal(e.reason, "forfeit");
  assert.equal(e.winnerId, "b");
  assert.equal(m.lives.a, 0);
  assert.ok(m.lives.b >= 1);
});

test("未宣言のまま締切を迎えても進む（罰にはしない）", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(13) });
  beginRound(m);
  assert.equal(autoDeclareKJ(m), true);
  assert.ok(["king", "joker"].includes(m.kjMode));
  assert.equal(m.phase, PHASE.CARD);
});

test("MODESの既定値で試合が成立する", () => {
  for (const mode of Object.values(MODES)) {
    const { m } = autoPlay(3, { lives: mode.lives, rounds: mode.rounds });
    assert.ok(m.ended);
    assert.equal(m.lives.a + m.lives.b, mode.lives * 2);
  }
});

// ─── 1局の拠出上限（roundBetCap） ───
// **これは見た目の調整ではなくルール。** 上限が無かった版は実測で局の24.9%がオールインになり、
// 1局目のオールインはそのまま試合の決着なので**12.6%の試合が1局で終わっていた**
// （審査員が1〜2試合しか触らない前提では、ゲームを見せる前に終わる確率がそれだけあった）。
// 「必ず1ライフ残る」を守るのはこの上限だけなので、崩れたら気付けるようにしておく。

test("1局の拠出は開始ライフ−1を超えない", () => {
  for (const mode of Object.values(MODES)) {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed);
      const m = createMatch({ ids: ["a", "b"], lives: mode.lives, rounds: mode.rounds, rng });
      while (!m.ended) {
        if (!beginRound(m)) break;
        declareKJ(m, cpuKJDecision(m));
        for (const id of m.ids) autoPickCard(m, id);
        beginBetting(m);
        let guard = 0;
        while (m.phase === PHASE.BETTING && guard++ < 200) {
          if (bettingExhausted(m)) break;
          const id = m.turn;
          const { action, fraction } = cpuBetDecision(m, id);
          betAction(m, id, action, fraction);
        }
        for (const id of m.ids) {
          assert.ok(m.contrib[id] <= roundBetCap(mode.lives),
            `${mode.id} seed${seed}: 拠出${m.contrib[id]} が上限${roundBetCap(mode.lives)}を超えた`);
        }
        resolveRound(m);
      }
    }
  }
});

test("どれだけ積んでも1局では削り切れない（1局決着が構造的に起きない）", () => {
  // ライフが満タンどうしなら、上限まで積み合っても負けた側に必ず1以上残る。
  for (const mode of Object.values(MODES)) {
    const m = createMatch({ ids: ["a", "b"], lives: mode.lives, rounds: mode.rounds, rng: mulberry32(7) });
    beginRound(m); declareKJ(m, "king");
    for (const id of m.ids) autoPickCard(m, id);
    beginBetting(m);
    // 上限まで積んでコールさせる（レイズが尽きるとcanRaiseがfalseになる）。
    let guard = 0;
    while (m.phase === PHASE.BETTING && guard++ < 50) {
      if (bettingExhausted(m)) break;
      const id = m.turn;
      betAction(m, id, betContext(m, id).canRaise ? "raise" : "call", 1);
    }
    resolveRound(m);
    assert.ok(Math.min(m.lives.a, m.lives.b) >= 1, `${mode.id}: 1局でライフが尽きた`);
    assert.equal(m.ended, null, `${mode.id}: 1局で試合が終わった`);
  }
});

test("上限は残りライフではなく開始ライフから引く（追い込まれた側の上限が縮まない）", () => {
  // 削られた側ほど1局に張れる額まで縮むと、巻き返しが構造的に効かなくなる。
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(3) });
  m.lives.a = 2;
  beginRound(m); declareKJ(m, "king");
  for (const id of m.ids) autoPickCard(m, id);
  beginBetting(m);
  // この局の上限は「持っていない分は出せない」側（effectiveStack=2）で決まる。
  assert.equal(m.roundCap, roundBetCap(6));
  assert.equal(m.cap, 2);
});

test("betContextはUIとCPUで同じ答えを返す（2箇所で計算しない）", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(21) });
  beginRound(m); declareKJ(m, "king");
  for (const id of m.ids) autoPickCard(m, id);
  beginBetting(m);
  const c = betContext(m);
  assert.equal(c.toCall, 0);
  assert.equal(c.room, m.cap - ANTE);
  assert.equal(c.canRaise, true);
});

// ─── 画面に出す額は「盤面の拠出の差」から取る（相手が積もうとした額ではない） ───
// 実測でコールの14.2%が、相手のレイズが1局の拠出上限で切られた局面だった。そこでは
// m.pendingAmount（積もうとした上乗せ幅）が実際に積まれた額を上回り、ボタンには
// 「コール +2」と出るのに相手は1しか増やしていない、という食い違いになる。
test("上限で切られたレイズのコール額は、積もうとした額ではなく盤面の差", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(7) });
  beginRound(m); declareKJ(m, "king");
  for (const id of m.ids) autoPickCard(m, id);
  beginBetting(m);
  const raiser = m.turn, caller = other(m, raiser);
  // 上限(5)まであと4しかない所へ、1ポット(=2)を2回積ませて切られる局面を作る。
  betAction(m, raiser, "raise", 1);      // 1 → 3
  betAction(m, caller, "raise", 1);      // 1 → 3+4=7 だが上限5で切られる
  assert.equal(m.contrib[caller], m.cap);
  // 積もうとした上乗せ幅は、実際に相手が払う額より大きい。
  assert.ok(m.pendingAmount > betContext(m, raiser).toCall);
  // コールで実際に動く額は betContext の toCall と一致する（表示はこちらを使うこと）。
  const before = m.contrib[raiser];
  const toCall = betContext(m, raiser).toCall;
  betAction(m, raiser, "call");
  assert.equal(m.contrib[raiser] - before, toCall);
  assert.equal(m.contrib[raiser], m.contrib[caller]);
});

// ─── ベットが1手も成立しない局がある ───
// 拠出の上限は少ない方の残りライフなので、残り1ライフの側が居る局はアンティ(1)が
// そのまま上限になり、積む余地が消える。実測でカジュアルの局の11.9%、**試合の28.6%**が
// この局で終わる——UIはここを黙って素通りせず「ALL IN」を一拍見せる（shared/pacing.js）。
test("残り1ライフの局はベットが成立しない（アンティが上限そのものになる）", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(31) });
  m.lives.a = 1; m.lives.b = 5;
  beginRound(m); declareKJ(m, "king");
  for (const id of m.ids) autoPickCard(m, id);
  beginBetting(m);
  assert.equal(m.cap, 1);
  assert.equal(m.contrib.a, 1);
  assert.equal(bettingExhausted(m), true);
  assert.equal(betContext(m).canRaise, false);
});

// ─── 降りた局は「卓に乗っていた額」と「動いたライフ」が一致しない ───
// 降りた側の拠出ぶんだけが動き、乗っていた側の上乗せは自分に戻る。reveal の pot は
// 卓に乗っていた実額、livesMoved は実際に動いた数で、**この2つを同じ値にしないこと。**
test("降りた局のポットと移動ライフは別の数（乗せた分は自分に戻る）", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(5) });
  beginRound(m); declareKJ(m, "king");
  for (const id of m.ids) autoPickCard(m, id);
  beginBetting(m);
  const raiser = m.turn, folder = other(m, raiser);
  betAction(m, raiser, "raise", 1);
  const staked = { ...m.contrib };
  const livesBefore = { ...m.lives };
  betAction(m, folder, "fold");
  const r = resolveRound(m);

  assert.equal(r.pot, staked.a + staked.b, "potは卓に乗っていた実額");
  assert.equal(r.moved, staked[folder], "動くのは降りた側の拠出ぶんだけ");
  assert.ok(r.pot > r.moved, "この局では2つが一致しないはず");
  // 乗せていた側は、上乗せぶんを失っていない。
  assert.equal(m.lives[raiser], livesBefore[raiser] + staked[folder]);
  assert.equal(m.lives[folder], livesBefore[folder] - staked[folder]);
});


// ─── アンティの段：「残り全部降りて逃げ切る」を潰すためのもの ───
//
// 消極的に打つ側が1局に失う額は、降りればアンティ（即降りなら拠出はアンティだけ）、
// 降りずに開示しても互いのアンティぶんだけ——つまり**アンティが1局あたりの最大失点**。
// アンティが1で固定だと最終局は差4で勝敗が決まり、実測でカジュアルの73.2%が
// 「最終局に入る時点で既に決まっている」状態だった。最終局のアンティを3にして窓を閉じる。
test("アンティが上がるのは最終局だけ", () => {
  for (const mode of Object.values(MODES)) {
    for (let r = 1; r < mode.rounds; r++) {
      assert.equal(anteFor(r, mode.rounds), ANTE, `${mode.id} の${r}局目は据え置き`);
    }
    assert.equal(anteFor(mode.rounds, mode.rounds), 3, `${mode.id} の最終局は3`);
    // サドンデス（ラウンド上限を超える局）も最終局と同じ額。
    assert.equal(anteFor(mode.rounds + 1, mode.rounds), 3);
  }
});

// **アンティが積む余地を食い潰さないこと。** 局がベット不能になるのは
// 「短い方の残りライフ <= アンティ」のときなので、アンティを上げるとその帯がそのまま広がる。
// cap-1 で切らないと、実測でベット不能局が11.9%→19.2%まで悪化した。
test("アンティは積む余地を食い潰さない（残りが2以上ある限りベットできる）", () => {
  for (let short = 2; short <= 8; short++) {
    const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(1) });
    m.round = m.rounds;                       // アンティがいちばん高い局で確かめる
    m.lives = { a: short, b: 12 - short };
    beginBetting(m);
    assert.ok(m.cap <= 1 || betContext(m).room >= 1,
      `短い方が${short}ライフの最終局でベットの余地が消えた（ante=${m.ante} cap=${m.cap}）`);
  }
});

// **これが直したかったものそのもの。** 差4でリードして最終局に入ったとき、
// リード側が降りても逃げ切れないこと＝最後の局が勝負として成立していること。
test("最終局は差4では逃げ切れない（リード側が降りても覆る）", () => {
  const m = createMatch({ ids: ["a", "b"], lives: 6, rounds: 8, rng: mulberry32(7) });
  beginRound(m);
  m.round = m.rounds;                         // 最終局の局面に置き直す
  m.lives = { a: 8, b: 4 };                   // 差4。アンティ1なら覆らなかった局面
  declareKJ(m, "king");
  for (const id of m.ids) autoPickCard(m, id);
  beginBetting(m);

  // リード側が即降りする＝失うのは自分の拠出（アンティ）だけ、という最善の消極策。
  const leader = "a", trailer = "b";
  m.turn = trailer;
  betAction(m, trailer, "raise", 1);          // 降りられる状況を作る
  assert.ok(betContext(m, leader).toCall > 0);
  betAction(m, leader, "fold");
  const r = resolveRound(m);

  assert.equal(r.potWinnerId, trailer);
  assert.ok(m.lives[trailer] > m.lives[leader],
    `降りて逃げ切れてしまった（${m.lives[leader]} vs ${m.lives[trailer]}）`);
});

// アンティを上げても**1局では削り切れない**（1局の拠出上限は据え置き）。
// この性質が壊れると1局決着が復活する——上限を触っていないことの歯止め。
test("アンティを上げても1局では削り切れない", () => {
  for (const mode of Object.values(MODES)) {
    const cap = roundBetCap(mode.lives, null, ANTE_TAIL);
    assert.ok(cap < mode.lives, `${mode.id}: 上限${cap} は開始ライフ${mode.lives}より小さいこと`);
    assert.ok(cap > Math.max(...ANTE_TAIL), `${mode.id}: 上限は最大アンティより大きいこと`);
  }
});
