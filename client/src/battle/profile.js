// 表示名の取得だけを切り出した薄いラッパー。
//
// **表示名の正はここ（localStorage の独立キー）だけ。** App.jsx の state はその写しで、設定画面もここへ書く。
// settings に入れず独立キーにしてあるのは、対戦画面から App を import すると循環importになるため。
const KEY = "kj_player_name";

export function getProfileName() {
  try { return localStorage.getItem(KEY) || "プレイヤー"; } catch { return "プレイヤー"; }
}

export function setProfileName(name) {
  try { localStorage.setItem(KEY, String(name || "").slice(0, 16) || "プレイヤー"); } catch { /* noop */ }
}
