// 配札の尺のユニットテスト。**3DとDOMがこの1枚の紙を共有していること**が要件なので、
// 数字そのものより「どちらから見ても同じ枚数・同じ時刻になる」ことを固定する。
//
// three.jsを一切importしない純粋なモジュールなので、Node上でそのまま読める
// （逆に言うと、ここに three からの import を足した時点でこのテストは動かなくなる——
//  DOM側がメインバンドルに3Dを引き込んでいないことの検査も兼ねている）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEAL_MS, DEAL_STAGGER_MS, dealtPerSide, selfCardLandsAt } from "./dealTiming.js";

test("1局目だけ2枚、以降は1枚（状態機械の draw() と同じ枚数）", () => {
  assert.equal(dealtPerSide(1), 2);
  for (const r of [2, 3, 8, 15]) assert.equal(dealtPerSide(r), 1);
});

test("配札の順は自分→相手の交互なので、自分のn枚目は2n番目に着く", () => {
  assert.equal(selfCardLandsAt(0), DEAL_MS);
  assert.equal(selfCardLandsAt(1), DEAL_MS + 2 * DEAL_STAGGER_MS);
});

test("2枚目は必ず1枚目より後に着く（同時に配ると枚数が絵からも音からも消える）", () => {
  assert.ok(selfCardLandsAt(1) > selfCardLandsAt(0));
});
