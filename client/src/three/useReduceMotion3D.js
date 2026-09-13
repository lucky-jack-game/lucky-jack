// 設定画面の「モーション低減」(storage.jsのgetSettings().reduceMotion)を3D演出の強度に反映する。
// 方針は「全て3Dにする」であり、この設定は3D表示自体のON/OFFスイッチには使わない。
// あくまでswing(常時の揺れ)・
// breathe(呼吸)・DOMアンカー追従のlerpアニメーションなど、付随的な動きの強度だけを抑える用途。
import { getSettings } from "../storage.js";

export function useReduceMotion3D() {
  // 対戦中は頻繁に呼ばれる箇所ではないため、都度読み出しでも問題ない(設定変更はSettingsScreen経由の
  // 都度保存であり、対戦中にリアルタイムで変わるものではないため購読の仕組みは不要と判断)。
  return getSettings().reduceMotion === true;
}
